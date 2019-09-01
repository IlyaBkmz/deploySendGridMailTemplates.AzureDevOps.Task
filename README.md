# Deploy SendGrid mail templates

Deploys mail templates to SendGrid using its API and stores template ids in Azure DevOps variable group.

## Getting Started

This extension solves a problem common to projects that use SendGrid templates and should be automatically deployed through Azure DevOps.  Often, you need to create different templates of letters to use in your project, but you are forced to do it manually now. This extension allows you to involve this process in release pipeline as one of the steps.

## Configuration
This extension requires an existing SendGrid account, Variable Group in Azure DevOps (its id can be found in url), in the Security of the variable group you need change the role of Project Collection Build Service to Administrator, also you need
allow scripts to access the OAuth token in the release settings. All mail templates should be located in the folder in the form of html files. The file names will be used as a name of variable to store template id in Variable groupe.

## Warnings
Using this extension you should remmeber that SendGrid has limitation to store only 300 transactional templates per account and this extension each time creates new templates without any deletions or updates.

## Authors

* Illia Chuikov

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Contributing

Please read [CONTRIBUTING.md](https://gist.github.com/PurpleBooth/b24679402957c63ec426) for details on our code of conduct, and the process for submitting pull requests.
