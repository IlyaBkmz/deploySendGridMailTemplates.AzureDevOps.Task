import tl = require('azure-pipelines-task-lib/task');
import fs = require('fs');

const request = require('request');      
const path = require('path');
const sendGridApiKeysUrl: string = 'https://api.sendgrid.com/v3/api_keys';
const sendGridTemplatesUrl: string = 'https://api.sendgrid.com/v3/templates';
const okResultCode: string = '200';
const sendGridTemplateGeneration: string = "dynamic";
const sendGridTemplateEditor: string = "code";
const htmlExtension: string = ".html";

interface variableGroupContent {
    name: string;
    variables: string[];
}

(async ()=> {
    try {
        tl.setResourcePath(path.join(__dirname, 'task.json'));
        const sendGridUserName: string = tl.getInput('sendGridUserName', true);
        const sendGridPassword: string = tl.getInput('sendGridPassword', true);
        const templatesDirectoryPath: string = tl.getPathInput('templatesDirectoryPath', true);
        const groupId: string = tl.getInput('groupId', true);
        const organisationName: string = tl.getVariable('System.TeamFoundationCollectionUri');
        const projectName: string = tl.getVariable('System.TeamProject');
        const azureDevOpsToken: string = tl.getVariable('System.AccessToken');
        const azureDevOpsTokenAuth = {
            'user': 'user',
            'pass': azureDevOpsToken
        };

        verifyTemplatesDirectory(templatesDirectoryPath);

        let htmlFiles = fs.readdirSync(templatesDirectoryPath).filter((file) => {
            return path.extname(file).toLowerCase() === htmlExtension;
        });

        if(htmlFiles.length == 0) {
            tl.setResult(tl.TaskResult.Failed, tl.loc("noHtmlFilesErrorMessage"));
            return;
        }
        
        const azureDevOpsApiUrl: string = `${organisationName}/${projectName}/_apis/distributedtask/variablegroups/${groupId}?api-version=5.1-preview.1`;

        let variableGroupContentPromise = new Promise<variableGroupContent>((resolve, reject) => {
        request.get(azureDevOpsApiUrl, {
                'auth': azureDevOpsTokenAuth
            }, async (error: any, response: any, body: any) => {
                if (response.statusCode == okResultCode ) {
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
            })
        });

        let variableGroupContent = await variableGroupContentPromise;       

        const sendGridUserNameAuth = {
            'user': sendGridUserName,
            'pass': sendGridPassword
        };

        let getSendGridApiKeyPromise = new Promise<Array<string>>((resolve) => {
            request.post(sendGridApiKeysUrl, {
                'auth': sendGridUserNameAuth,
                'json': {
                    'name': "API key to load templates",
                    'scopes': [
                        "templates.create",
                        "templates.versions.create",
                    ]
                }
            }, async (error: any, response: any, body: any) => {
                if (body.errors) {
                    tl.setResult(tl.TaskResult.Failed, `${tl.loc("apiKeyCreateErrorMessage")} Status code: ${response.statusCode}, error: ${body.errors[0].message}.`);
                    return;
                }
                resolve([body.api_key, body.api_key_id]);
            })
        });

        let [sendGridApiKey, sendGridApiKeyId] = await getSendGridApiKeyPromise;
        const sendGridApiKeyAuth = {
            'bearer': sendGridApiKey
        };

        let templateIds: string[] = variableGroupContent.variables;
        for (let file of htmlFiles) {
                let htmlContent = fs.readFileSync(templatesDirectoryPath + '/' + file, 'utf-8');
                let fileName = path.basename(file, htmlExtension);
                let createTemplatePromise = new Promise<string>((resolve) => {
                    request.post(sendGridTemplatesUrl, {
                        'auth': sendGridApiKeyAuth,
                        'json': {
                            "name": fileName,
                            "generation": sendGridTemplateGeneration
                        }
                    }, async (error: any, response: any, body: any) =>
                    {
                        if (body.errors) {
                            deleteSendGridApiKey(sendGridUserNameAuth, sendGridApiKeyId);
                            tl.setResult(tl.TaskResult.Failed, `${tl.loc("templateCreateErrorMessage")} Status code: ${response.statusCode}, error: ${body.errors[0].message}.`);
                            return;
                        }
                        resolve(body.id);
                    })
                });

                let createdTemplateId: string = await createTemplatePromise;
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
                    }, async (error: any, response: any, body: any) =>
                    {
                        if (body.errors) {
                            deleteSendGridApiKey(sendGridUserNameAuth, sendGridApiKeyId);
                            tl.setResult(tl.TaskResult.Failed, `${tl.loc("templateVersionCreateErrorMessage")} Status code: ${response.statusCode}, error: ${body.errors[0].message}.`);
                            return;
                        }
                });
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
        }, (error: any, response: any, body: any) =>
        {
            if (body == 'null' || response.statusCode != okResultCode) {
                tl.setResult(tl.TaskResult.Failed, `${tl.loc("variableGroupUpdateErrorMessage")}`);
                return;
            }
        });
    }
    catch (error) {
        tl.setResult(tl.TaskResult.Failed, error.message);
    }
})();

function deleteSendGridApiKey(sendGridUserNameAuth: any, sendGridApiKeyId: string) {
    request.delete(`${sendGridApiKeysUrl}/${sendGridApiKeyId}`, {
            'auth': sendGridUserNameAuth,
        }, (error: any, response: any, body: any) =>
        {
            if (body.errors) {
                tl.setResult(tl.TaskResult.Failed, `${tl.loc("apiKeyDeleteErrorMessage")} Status code: ${response.statusCode}, error: ${body.errors[0].message}.`);
                return;
            }
        });
}

function verifyTemplatesDirectory(templatesDirectoryPath: string) {
    if(!tl.exist(templatesDirectoryPath)) {
        tl.setResult(tl.TaskResult.Failed, tl.loc("directoryDoesNotExistErrorMessage"));
        return;
    }

    if(!tl.stats(templatesDirectoryPath).isDirectory()) {
        tl.setResult(tl.TaskResult.Failed, tl.loc("specifiedPathIsNotAFolderErrorMessage"));
        return;
    }
}
