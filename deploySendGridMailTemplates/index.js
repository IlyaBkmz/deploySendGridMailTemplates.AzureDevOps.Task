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
const directoryDoesNotExistErrorMessage = "The specified directory with tepmlates doesn't exist.";
const specifiedPathIsNotFolderErrorMessage = "The specified path is not a folder.";
const noHtmlFilesErrorMessage = "There are not any html files in specified folder.";
const apiKeyDeleteErrorMessage = "The delete of SendGrid API key was unsuccessful.";
const apiKeyCreateErrorMessage = "The creation of SendGrid API key was unsuccessful.";
const variableGroupUpdateErrorMessage = "Update of Variable Group was unsuccessful.";
const variableGroupWasNotFoundErrorMessage = "Variable Group was not found.";
const templateCreateErrorMessage = "The creation of template was unsuccessful.";
const templateVersionCreateErrorMessage = "The creation of template version was unsuccessful.";
const variableGroupDescription = "Contains ids of SendGrid mail templates.";
const sendGridapiKeysUrl = 'https://api.sendgrid.com/v3/api_keys';
const sendGridTemplatesUrl = 'https://api.sendgrid.com/v3/templates';
const okResultCode = '200';
const createdCode = '201';
const noContentResultCode = '204';
const sendGridTemplateGeneration = "dynamic";
const sendGridTemplateEditor = "code";
const sendGridApiKeyName = "API key to load templates";
const htmlExtension = ".html";
(() => __awaiter(this, void 0, void 0, function* () {
    try {
        const sendGridUserName = tl.getInput('sendGridUserName', true);
        const sendGridPassword = tl.getInput('sendGridPassword', true);
        const templatesDirectoryPath = tl.getPathInput('templatesDirectoryPath', true);
        const groupId = tl.getInput('groupId', true);
        const organisationName = tl.getInput('organisationName', true); //tl.getVariable('System.TeamFoundationCollectionUri');
        const projectName = tl.getInput('projectName', true); //tl.getVariable('System.TeamProject');
        const azureDevOpsToken = tl.getInput('azureDevOpsToken', true); //tl.getVariable('System.AccessToken');
        const azureDevOpsTokenAuth = {
            'user': 'user',
            'pass': azureDevOpsToken
        };
        if (!tl.exist(templatesDirectoryPath)) {
            tl.setResult(tl.TaskResult.Failed, directoryDoesNotExistErrorMessage);
            return;
        }
        if (!tl.stats(templatesDirectoryPath).isDirectory()) {
            tl.setResult(tl.TaskResult.Failed, specifiedPathIsNotFolderErrorMessage);
            return;
        }
        let htmlFiles = fs.readdirSync(templatesDirectoryPath).filter((file) => {
            return path.extname(file).toLowerCase() === htmlExtension;
        });
        if (htmlFiles.length == 0) {
            tl.setResult(tl.TaskResult.Failed, noHtmlFilesErrorMessage);
            return;
        }
        const azureDevOpsApiUrl = `${organisationName}/${projectName}/_apis/distributedtask/variablegroups/${groupId}?api-version=5.1-preview.1`;
        let variableGroupContentPromise = new Promise((resolve) => {
            request.get(azureDevOpsApiUrl, {
                'auth': azureDevOpsTokenAuth
            }, (error, response, body) => __awaiter(this, void 0, void 0, function* () {
                if (response.statusCode != okResultCode) {
                    tl.setResult(tl.TaskResult.Failed, `${variableGroupWasNotFoundErrorMessage} Status code: ${response.statusCode}, error details: ${error}.`);
                    return;
                }
                let jsonBody = JSON.parse(body);
                resolve({ 'name': jsonBody.name, 'variables': jsonBody.variables });
            }));
        });
        let variableGroupContent = yield variableGroupContentPromise;
        const sendGridUserNameAuth = {
            'user': sendGridUserName,
            'pass': sendGridPassword
        };
        let getSendGridApiKeyPromise = new Promise((resolve) => {
            request.post(sendGridapiKeysUrl, {
                'auth': sendGridUserNameAuth,
                'json': {
                    'name': sendGridApiKeyName,
                    'scopes': [
                        "templates.create",
                        "templates.versions.create",
                    ]
                }
            }, (error, response, body) => __awaiter(this, void 0, void 0, function* () {
                if (error) {
                    tl.setResult(tl.TaskResult.Failed, `${apiKeyCreateErrorMessage} Status code: ${response.statusCode}, error details: ${error}.`);
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
                    if (response.statusCode != createdCode) {
                        yield deleteSendGridApiKey(request, sendGridUserNameAuth, sendGridApiKeyId);
                        tl.setResult(tl.TaskResult.Failed, `${templateCreateErrorMessage} Status code: ${response.statusCode}, error details: ${error}.`);
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
            }, (error, response) => __awaiter(this, void 0, void 0, function* () {
                if (response.statusCode != createdCode) {
                    yield deleteSendGridApiKey(request, sendGridUserNameAuth, sendGridApiKeyId);
                    tl.setResult(tl.TaskResult.Failed, `${templateVersionCreateErrorMessage} Status code: ${response.statusCode}, error details: ${error}.`);
                    return;
                }
            }));
        }
        yield deleteSendGridApiKey(request, sendGridUserNameAuth, sendGridApiKeyId);
        request.put(azureDevOpsApiUrl, {
            'json': {
                "variables": templateIds,
                "type": "Vsts",
                "name": variableGroupContent.name,
                "description": variableGroupDescription
            },
            'auth': azureDevOpsTokenAuth,
        }, (error, response) => __awaiter(this, void 0, void 0, function* () {
            if (response.statusCode != okResultCode) {
                tl.setResult(tl.TaskResult.Failed, `${variableGroupUpdateErrorMessage} Status code: ${response.statusCode}, error details: ${error}.`);
                return;
            }
        }));
    }
    catch (error) {
        tl.setResult(tl.TaskResult.Failed, error.message);
    }
}))();
function deleteSendGridApiKey(request, sendGridUserNameAuth, sendGridApiKeyId) {
    return __awaiter(this, void 0, void 0, function* () {
        request.delete(`${sendGridapiKeysUrl}/${sendGridApiKeyId}`, {
            'auth': sendGridUserNameAuth,
        }, (error, response) => __awaiter(this, void 0, void 0, function* () {
            if (response.statusCode != noContentResultCode) {
                tl.setResult(tl.TaskResult.Failed, `${apiKeyDeleteErrorMessage} Status code: ${response.statusCode}, error details: ${error}.`);
                return;
            }
        }));
    });
}
