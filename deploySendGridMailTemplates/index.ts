import tl = require('azure-pipelines-task-lib/task');
import fs = require('fs');

const request = require('request');      
const path = require('path');
const directoryDoesNotExistErrorMessage: string = "The specified directory with tepmlates doesn't exist.";
const specifiedPathIsNotFolderErrorMessage: string = "The specified path is not a folder.";
const noHtmlFilesErrorMessage: string = "There are not any html files in specified folder.";
const apiKeyDeleteErrorMessage: string = "The delete of SendGrid API key was unsuccessful.";
const apiKeyCreateErrorMessage: string = "The creation of SendGrid API key was unsuccessful.";
const variableGroupUpdateErrorMessage: string = "Update of Variable Group was unsuccessful.";
const variableGroupWasNotFoundErrorMessage: string = "Variable Group was not found.";
const templateCreateErrorMessage: string = "The creation of template was unsuccessful.";
const templateVersionCreateErrorMessage: string = "The creation of template version was unsuccessful.";
const variableGroupDescription: string = "Contains ids of SendGrid mail templates.";
const sendGridapiKeysUrl: string = 'https://api.sendgrid.com/v3/api_keys';
const sendGridTemplatesUrl: string = 'https://api.sendgrid.com/v3/templates';
const okResultCode: string = '200';
const createdCode: string = '201';
const noContentResultCode: string = '204';
const sendGridTemplateGeneration: string = "dynamic";
const sendGridTemplateEditor: string = "code";
const sendGridApiKeyName: string = "API key to load templates";
const htmlExtension: string = ".html";

interface variableGroupContent {
    name: string;
    variables: string[];
}

(async ()=> {
    try {
        const sendGridUserName: string = tl.getInput('sendGridUserName', true);
        const sendGridPassword: string = tl.getInput('sendGridPassword', true);
        const templatesDirectoryPath: string = tl.getPathInput('templatesDirectoryPath', true);
        const groupId: string = tl.getInput('groupId', true);
        const organisationName: string = tl.getInput('organisationName', true);//tl.getVariable('System.TeamFoundationCollectionUri');
        const projectName: string = tl.getInput('projectName', true);//tl.getVariable('System.TeamProject');
        const azureDevOpsToken: string = tl.getInput('azureDevOpsToken', true);//tl.getVariable('System.AccessToken');
        const azureDevOpsTokenAuth = {
            'user': 'user',
            'pass': azureDevOpsToken
        };
        
        if(!tl.exist(templatesDirectoryPath))
        {
            tl.setResult(tl.TaskResult.Failed, directoryDoesNotExistErrorMessage);
            return;
        }

        if(!tl.stats(templatesDirectoryPath).isDirectory())
        {
            tl.setResult(tl.TaskResult.Failed, specifiedPathIsNotFolderErrorMessage);
            return;
        }

        let htmlFiles = fs.readdirSync(templatesDirectoryPath).filter((file) => {
            return path.extname(file).toLowerCase() === htmlExtension;
        });

        if(htmlFiles.length == 0)
        {
            tl.setResult(tl.TaskResult.Failed, noHtmlFilesErrorMessage);
            return;
        }
        
        const azureDevOpsApiUrl: string = `${organisationName}/${projectName}/_apis/distributedtask/variablegroups/${groupId}?api-version=5.1-preview.1`;

        let variableGroupContentPromise = new Promise<variableGroupContent>((resolve) => {
        request.get(azureDevOpsApiUrl, {
                'auth': azureDevOpsTokenAuth
            }, async (error: any, response: any, body: any) =>
            {
                if (response.statusCode != okResultCode) {
                    tl.setResult(tl.TaskResult.Failed, `${variableGroupWasNotFoundErrorMessage} Status code: ${response.statusCode}, error details: ${error}.`);
                    return;
                }
                let jsonBody = JSON.parse(body);  
                resolve({ 'name': jsonBody.name, 'variables': jsonBody.variables });
            })
        });

        let variableGroupContent = await variableGroupContentPromise;


        const sendGridUserNameAuth = {
            'user': sendGridUserName,
            'pass': sendGridPassword
        };

        let getSendGridApiKeyPromise = new Promise<Array<string>>((resolve) => {
            request.post(sendGridapiKeysUrl, {
                'auth': sendGridUserNameAuth,
                'json': {
                    'name': sendGridApiKeyName,
                    'scopes': [
                        "templates.create",
                        "templates.versions.create",
                    ]
                }
            }, async (error: any, response: any, body: any) => {
                if (error) {
                    tl.setResult(tl.TaskResult.Failed, `${apiKeyCreateErrorMessage} Status code: ${response.statusCode}, error details: ${error}.`);
                    return;
                }
                resolve([body.api_key, body.api_key_id]);
            })
        });

        let [sendGridApiKey, sendGridApiKeyId]=  await getSendGridApiKeyPromise;
        const sendGridApiKeyAuth = {
            'bearer': sendGridApiKey
        };

        let templateIds: any = variableGroupContent.variables;
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
                        if (response.statusCode != createdCode) {
                            await deleteSendGridApiKey(request, sendGridUserNameAuth, sendGridApiKeyId);
                            tl.setResult(tl.TaskResult.Failed, `${templateCreateErrorMessage} Status code: ${response.statusCode}, error details: ${error}.`);
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
                    }, async (error: any, response: any) =>
                    {
                        if (response.statusCode != createdCode) {
                            await deleteSendGridApiKey(request, sendGridUserNameAuth, sendGridApiKeyId);
                            tl.setResult(tl.TaskResult.Failed, `${templateVersionCreateErrorMessage} Status code: ${response.statusCode}, error details: ${error}.`);
                            return;
                        }
                });
        }

        await deleteSendGridApiKey(request, sendGridUserNameAuth, sendGridApiKeyId);

        request.put(azureDevOpsApiUrl, {
            'json': {
                "variables": templateIds,
                "type": "Vsts",
                "name": variableGroupContent.name,
                "description": variableGroupDescription
            },
            'auth': azureDevOpsTokenAuth,
        }, async (error: any, response: any) =>
        {
            if (response.statusCode != okResultCode) {
                tl.setResult(tl.TaskResult.Failed, `${variableGroupUpdateErrorMessage} Status code: ${response.statusCode}, error details: ${error}.`);
                return;
            }
        });
    }
    catch (error) {
        tl.setResult(tl.TaskResult.Failed, error.message);
    }
})();

async function deleteSendGridApiKey(request: any, sendGridUserNameAuth: any, sendGridApiKeyId: string) {
    request.delete(`${sendGridapiKeysUrl}/${sendGridApiKeyId}`, {
            'auth': sendGridUserNameAuth,
        }, async (error: any, response: any) =>
        {
            if (response.statusCode != noContentResultCode) {
                tl.setResult(tl.TaskResult.Failed, `${apiKeyDeleteErrorMessage} Status code: ${response.statusCode}, error details: ${error}.`);
                return;
            }
        });
}
