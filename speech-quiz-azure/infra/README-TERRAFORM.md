Infra notes:
- This folder contains sample Terraform to provision Azure resources.
- Customize variables in terraform.tfvars, then run:
  terraform init
  terraform apply

This sample config creates:
- Resource group
- Storage account (blob)
- Cosmos DB account
- Key Vault
- App Service plan + App Service
- Speech resource and cognitive services (note: azure_openai may require manual enrollment)
- Managed identity for the app to access Key Vault
