// Copyright (c) 2017 Queensland Cyber Infrastructure Foundation (http://www.qcif.edu.au/)
//
// GNU GENERAL PUBLIC LICENSE
//    Version 2, June 1991
//
// This program is free software; you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation; either version 2 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License along
// with this program; if not, write to the Free Software Foundation, Inc.,
// 51 Franklin Street, Fifth Floor, Boston, MA 02110-1301 USA.

import { Observable } from 'rxjs';

import { Sails, Model } from "sails";
import { launch } from 'puppeteer';
import fs = require('fs-extra');
import moment = require('moment'); 
const os = require('os');
const path = require('path');

import { Services as service, Datastream } from '@researchdatabox/redbox-core-types';

declare var sails: Sails;
declare var RecordType: Model;
declare var _this;
declare var _;
declare var User;
declare var RecordsService;
declare var UsersService;

export module Services {
  /**
   * WorkflowSteps related functions...
   *
   * Author: <a href='https://github.com/shilob' target='_blank'>Shilo Banihit</a>
   *
   */
  export class PDF extends service.Core.Service {

    public processMap: any = {};
    public pool: any;

    protected _exportedMethods: any = [
      'createPDF',
      'initPool'
    ];

    public initPool() {

    }

    private async generatePDF(oid: string, record: any, options: any) {
      sails.log.verbose("PDFService::Creating PDF for: " + oid);
      // Added to support storage backend hooks, degrading gracefully
      let datastreamService = RecordsService;
      let compatMode = false;
      if (_.isEmpty(sails.config.record) || _.isEmpty(sails.config.record.datastreamService)) {
        if (!_.isEmpty(datastreamService.addDatastream) && _.isFunction(datastreamService.addDatastream)) {
          sails.log.warn(`PDFService::Plugin is guessing which DatastreamService to use, please set 'sails.config.record.datastreamService' explicitly or use the appropriate version of the PDF plugin.`);
          compatMode = true;
        } else {
          sails.log.error(`PDFService::Failed to retrieve datastream service name, please set 'sails.config.storage.serviceName'`);
          return;
        }
      } else {
        sails.log.verbose(`PDFService::Using datastreamService: ${sails.config.storage.serviceName}`);
        datastreamService = sails.services[sails.config.storage.serviceName];
        if (_.isUndefined(datastreamService)) {
          sails.log.error(`PDFService::Could not find service!`);
          return;
        }
      }
      const token = options['token']? options['token'] : undefined;
      if (token == undefined) {
        sails.log.warn("PDFService::API token for PDF generation is not set. Skipping generation: " + oid);
        return;
      }
      sails.log.verbose(`PDFService::Acquiring browser from pool....`);

      //Ensure the user data dir is new each run so that the browser is completely clean
      const tmpUserDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfgen'));
      const browser = await launch({executablePath: options['chrome_path'] ? options['chrome_path'] : '/usr/bin/google-chrome-stable', headless: true, args: ['--no-sandbox', `--user-data-dir=${tmpUserDataDir}`] });

      sails.log.verbose(`PDFService::Creating new page....`)
      const page = await browser.newPage();
      page.setExtraHTTPHeaders({
        Authorization: 'Bearer '+ token
      });
      //TODO: get branding name from record
      let sourceUrlBase = options['sourceUrlBase'] || '/default/rdmp/record/view';
      let currentURL = `${sails.config.appUrl}${sourceUrlBase}/${oid}`;
      this.processMap[currentURL] = true;
      sails.log.debug(`PDFService::Chromium loading page: ${currentURL}`);
      await page.goto(currentURL);
      try {
        await page.waitForSelector(options['waitForSelector'], { timeout: 60000 });
        sails.log.verbose(`PDFService::loaded page: ${currentURL}, waiting further...`);
        await this.delay(1500);
        const date = moment().format('x');
        const pdfPrefix = options['pdfPrefix']
        const fileId = `${pdfPrefix}-${oid}-${date}.pdf`
        const targetDir = sails.config.record.attachments.stageDir;
        sails.log.verbose(`PDFService::Checking target dir: ${targetDir}`);
        await fs.ensureDir(targetDir);
        sails.log.verbose(`PDFService::Printing PDF for ${oid}`);
        const fpath = `${sails.config.record.attachments.stageDir}/${fileId}`;
        let defaultPDFOptions:any = {
          path: fpath,
          format: 'A4',
          printBackground: true
        };
        if (options['PDFOptions']) {
          // We don't want the file path to be overriden
          delete options['PDFOptions']['path'];
          defaultPDFOptions = _.merge(defaultPDFOptions, options['PDFOptions']);
        }
        await page.pdf(defaultPDFOptions);
        sails.log.debug(`PDFService::Generated PDF at ${sails.config.record.attachments.stageDir}/${fileId} `);
        await page.close();
        // await this.pool.release(browser);
        await browser.close();
        sails.log.verbose(`PDFService::Saving PDF: ${oid}`);
        let savedPdfResponse = null;
        if (compatMode) {
          savedPdfResponse = await datastreamService.addDatastream(oid, fileId);
        } else {
          const datastream = new Datastream({fileId: fileId, name: fileId});
          savedPdfResponse = await datastreamService.addDatastream(oid, datastream);
        }
        sails.log.debug(`PDFService::Saved PDF to storage: ${oid}`);
        _.unset(this.processMap[currentURL]);
      } catch (e) {
        sails.log.error(`PDFService::Error encountered while generating the PDF: ${oid}`);
        sails.log.error(e);
        sails.log.error(JSON.stringify(e));
        try{
          await browser.close();
        } catch (e) {
          sails.log.error(`PDFService:: Failed to close browser after error`);
          sails.log.error(e);
        }
      } finally {
        // clean up in case browser didn't close properly
        if (browser && browser.process() != null) { 
          browser.process().kill('SIGTERM');
        }
        fs.removeSync(tmpUserDataDir, { recursive: true });
      }
      return record;
    }

    public createPDF(oid, record, options, user) {
      return Observable.fromPromise(this.generatePDF(oid, record, options));
    }

    private delay(time) {
      return new Promise(function(resolve) {
        setTimeout(resolve, time)
      });
    }

  }

}
module.exports = new Services.PDF().exports();
