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
const tl = require("azure-pipelines-task-lib/task");
const fs = require("fs");
const request = require('request');
const path = require('path');
const sendGridApiKeysUrl = 'https://api.sendgrid.com/v3/api_keys';
const sendGridTemplatesUrl = 'https://api.sendgrid.com/v3/templates';
const okResultCode = '200';
const sendGridTemplateGeneration = "dynamic";
const sendGridTemplateEditor = "code";
const htmlExtension = ".html";
(() => __awaiter(this, void 0, void 0, function* () {
    try {
        tl.setResourcePath(path.join(__dirname, 'task.json'));
        const sendGridUserName = tl.getInput('sendGridUserName', true);
        const sendGridPassword = tl.getInput('sendGridPassword', true);
        const templatesDirectoryPath = tl.getPathInput('templatesDirectoryPath', true);
        const groupId = tl.getInput('groupId', true);
        const organisationName = tl.getVariable('System.TeamFoundationCollectionUri');
        const projectName = tl.getVariable('System.TeamProject');
        const azureDevOpsToken = tl.getVariable('System.AccessToken');
        const azureDevOpsTokenAuth = {
            'user': 'user',
            'pass': azureDevOpsToken
        };
        verifyTemplatesDirectory(templatesDirectoryPath);
        let htmlFiles = fs.readdirSync(templatesDirectoryPath).filter((file) => {
            return path.extname(file).toLowerCase() === htmlExtension;
        });
        if (htmlFiles.length == 0) {
            tl.setResult(tl.TaskResult.Failed, tl.loc("noHtmlFilesErrorMessage"));
            return;
        }
        const azureDevOpsApiUrl = `${organisationName}/${projectName}/_apis/distributedtask/variablegroups/${groupId}?api-version=5.1-preview.1`;
        let variableGroupContentPromise = new Promise((resolve, reject) => {
            request.get(azureDevOpsApiUrl, {
                'auth': azureDevOpsTokenAuth
            }, (error, response, body) => __awaiter(this, void 0, void 0, function* () {
                if (response.statusCode == okResultCode) {
                    if (body != 'null') {
                        let jsonBody = JSON.parse(body);
                        resolve({ 'name': jsonBody.name, 'variables': jsonBody.variables });
                    }
                    else {
                        reject(new Error(`${tl.loc("variableGroupWasNotFoundErrorMessage")}`));
                    }
                }
                else {
                    reject(new Error(`${tl.loc("insufficientPermissionsErrorMessage")}`));
                }
            }));
        });
        let variableGroupContent = yield variableGroupContentPromise;
        const sendGridUserNameAuth = {
            'user': sendGridUserName,
            'pass': sendGridPassword
        };
        let getSendGridApiKeyPromise = new Promise((resolve) => {
            request.post(sendGridApiKeysUrl, {
                'auth': sendGridUserNameAuth,
                'json': {
                    'name': "API key to load templates",
                    'scopes': [
                        "templates.create",
                        "templates.versions.create",
                    ]
                }
            }, (error, response, body) => __awaiter(this, void 0, void 0, function* () {
                if (body.errors) {
                    tl.setResult(tl.TaskResult.Failed, `${tl.loc("apiKeyCreateErrorMessage")} Status code: ${response.statusCode}, error: ${body.errors[0].message}.`);
                    return;
                }
                resolve([body.api_key, body.api_key_id]);
            }));
        });
        let [sendGridApiKey, sendGridApiKeyId] = yield getSendGridApiKeyPromise;
        const sendGridApiKeyAuth = {
            'bearer': sendGridApiKey
        };
        let templateIds = variableGroupContent.variables;
        for (let file of htmlFiles) {
            let htmlContent = fs.readFileSync(templatesDirectoryPath + '/' + file, 'utf-8');
            let fileName = path.basename(file, htmlExtension);
            let createTemplatePromise = new Promise((resolve) => {
                request.post(sendGridTemplatesUrl, {
                    'auth': sendGridApiKeyAuth,
                    'json': {
                        "name": fileName,
                        "generation": sendGridTemplateGeneration
                    }
                }, (error, response, body) => __awaiter(this, void 0, void 0, function* () {
                    if (body.errors) {
                        deleteSendGridApiKey(sendGridUserNameAuth, sendGridApiKeyId);
                        tl.setResult(tl.TaskResult.Failed, `${tl.loc("templateCreateErrorMessage")} Status code: ${response.statusCode}, error: ${body.errors[0].message}.`);
                        return;
                    }
                    resolve(body.id);
                }));
            });
            let createdTemplateId = yield createTemplatePromise;
            templateIds[fileName] = createdTemplateId;
            request.post(`${sendGridTemplatesUrl}/${createdTemplateId}/versions`, {
                'auth': sendGridApiKeyAuth,
                'json': {
                    "name": fileName,
                    "active": 1,
                    "html_content": htmlContent,
                    "subject": "{{{ subject }}}",
                    "editor": sendGridTemplateEditor
                }
            }, (error, response, body) => __awaiter(this, void 0, void 0, function* () {
                if (body.errors) {
                    deleteSendGridApiKey(sendGridUserNameAuth, sendGridApiKeyId);
                    tl.setResult(tl.TaskResult.Failed, `${tl.loc("templateVersionCreateErrorMessage")} Status code: ${response.statusCode}, error: ${body.errors[0].message}.`);
                    return;
                }
            }));
        }
        deleteSendGridApiKey(sendGridUserNameAuth, sendGridApiKeyId);
        request.put(azureDevOpsApiUrl, {
            'json': {
                "variables": templateIds,
                "type": "Vsts",
                "name": variableGroupContent.name,
                "description": tl.loc("variableGroupDescription")
            },
            'auth': azureDevOpsTokenAuth,
        }, (error, response, body) => {
            if (body == 'null' || response.statusCode != okResultCode) {
                tl.setResult(tl.TaskResult.Failed, `${tl.loc("variableGroupUpdateErrorMessage")}`);
                return;
            }
        });
    }
    catch (error) {
        tl.setResult(tl.TaskResult.Failed, error.message);
    }
}))();
function deleteSendGridApiKey(sendGridUserNameAuth, sendGridApiKeyId) {
    request.delete(`${sendGridApiKeysUrl}/${sendGridApiKeyId}`, {
        'auth': sendGridUserNameAuth,
    }, (error, response, body) => {
        if (body.errors) {
            tl.setResult(tl.TaskResult.Failed, `${tl.loc("apiKeyDeleteErrorMessage")} Status code: ${response.statusCode}, error: ${body.errors[0].message}.`);
            return;
        }
    });
}
function verifyTemplatesDirectory(templatesDirectoryPath) {
    if (!tl.exist(templatesDirectoryPath)) {
        tl.setResult(tl.TaskResult.Failed, tl.loc("directoryDoesNotExistErrorMessage"));
        return;
    }
    if (!tl.stats(templatesDirectoryPath).isDirectory()) {
        tl.setResult(tl.TaskResult.Failed, tl.loc("specifiedPathIsNotAFolderErrorMessage"));
        return;
    }
}
