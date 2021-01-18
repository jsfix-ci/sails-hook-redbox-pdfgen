"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const Rx_1 = require("rxjs/Rx");
const services = require("../core/CoreService.js");
const fs = require("fs-extra");
const moment = require("moment");
const createPuppeteerPool = require("@invertase/puppeteer-pool");
const Datastream_1 = require("../core/Datastream");
var Services;
(function (Services) {
    class PDF extends services.Services.Core.Service {
        constructor() {
            super(...arguments);
            this.processMap = {};
            this._exportedMethods = [
                'createPDF',
                'initPool'
            ];
        }
        initPool() {
            const browserPoolMin = _.isUndefined(sails.config.pdfgen) || _.isUndefined(sails.config.pdfgen.minPool) ? 2 : _.toNumber(sails.config.pdfgen.minPool);
            const browserPoolMax = _.isUndefined(sails.config.pdfgen) || _.isUndefined(sails.config.pdfgen.maxPool) ? 10 : _.toNumber(sails.config.pdfgen.maxPool);
            this.pool = createPuppeteerPool({
                min: browserPoolMin,
                max: browserPoolMax,
                puppeteerLaunchArgs: [{ headless: true, args: ['--no-sandbox'] }]
            });
        }
        generatePDF(oid, record, options) {
            return __awaiter(this, void 0, void 0, function* () {
                sails.log.verbose("PDFService::Creating PDF for: " + oid);
                let datastreamService = RecordsService;
                let compatMode = false;
                if (_.isEmpty(sails.config.record) || _.isEmpty(sails.config.record.datastreamService)) {
                    if (!_.isEmpty(datastreamService.addDatastream) && _.isFunction(datastreamService.addDatastream)) {
                        sails.log.warn(`PDFService::Plugin is guessing which DatastreamService to use, please set 'sails.config.record.datastreamService' explicitly or use the appropriate version of the PDF plugin.`);
                        compatMode = true;
                    }
                    else {
                        sails.log.error(`PDFService::Failed to retrieve datastream service name, please set 'sails.config.storage.serviceName'`);
                        return;
                    }
                }
                else {
                    datastreamService = sails.services[sails.config.storage.serviceName];
                }
                const token = options['token'] ? options['token'] : undefined;
                if (token == undefined) {
                    sails.log.warn("PDFService::API token for PDF generation is not set. Skipping generation: " + oid);
                    return;
                }
                const browser = yield this.pool.acquire();
                const page = yield browser.newPage();
                page.setExtraHTTPHeaders({
                    Authorization: 'Bearer ' + token
                });
                let sourceUrlBase = options['sourceUrlBase'] || '/default/rdmp/record/view';
                let currentURL = `${sails.config.appUrl}${sourceUrlBase}/${oid}`;
                this.processMap[currentURL] = true;
                sails.log.debug(`PDFService::Chromium loading page: ${currentURL}`);
                yield page.goto(currentURL);
                try {
                    yield page.waitForSelector(options['waitForSelector'], { timeout: 60000 });
                    sails.log.verbose(`PDFService::loaded page: ${currentURL}, waiting further...`);
                    yield this.delay(1500);
                    const date = moment().format('x');
                    const pdfPrefix = options['pdfPrefix'];
                    const fileId = `${pdfPrefix}-${oid}-${date}.pdf`;
                    const targetDir = sails.config.record.attachments.stageDir;
                    sails.log.verbose(`PDFService::Checking target dir: ${targetDir}`);
                    yield fs.ensureDir(targetDir);
                    sails.log.verbose(`PDFService::Printing PDF for ${oid}`);
                    const fpath = `${sails.config.record.attachments.stageDir}/${fileId}`;
                    let defaultPDFOptions = {
                        path: fpath,
                        format: 'A4',
                        printBackground: true
                    };
                    if (options['PDFOptions']) {
                        delete options['PDFOptions']['path'];
                        defaultPDFOptions = _.merge(defaultPDFOptions, options['PDFOptions']);
                    }
                    yield page.pdf(defaultPDFOptions);
                    sails.log.debug(`PDFService::Generated PDF at ${sails.config.record.attachments.stageDir}/${fileId} `);
                    yield page.close();
                    yield this.pool.release(browser);
                    sails.log.verbose(`PDFService::Saving PDF: ${oid}`);
                    let savedPdfResponse = null;
                    if (compatMode) {
                        savedPdfResponse = yield datastreamService.addDatastream(oid, fileId);
                    }
                    else {
                        const datastream = new Datastream_1.default({ fileId: fileId, name: fileId });
                        savedPdfResponse = yield datastreamService.addDatastream(oid, datastream);
                    }
                    sails.log.debug(`PDFService::Saved PDF to storage: ${oid}`);
                    _.unset(this.processMap[currentURL]);
                }
                catch (e) {
                    sails.log.error(`PDFService::Error encountered while generating the PDF: ${oid}`);
                    sails.log.error(e);
                    sails.log.error(JSON.stringify(e));
                }
                return record;
            });
        }
        createPDF(oid, record, options, user) {
            return Rx_1.Observable.fromPromise(this.generatePDF(oid, record, options));
        }
        delay(time) {
            return new Promise(function (resolve) {
                setTimeout(resolve, time);
            });
        }
    }
    Services.PDF = PDF;
})(Services = exports.Services || (exports.Services = {}));
module.exports = new Services.PDF().exports();
