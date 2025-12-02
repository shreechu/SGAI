terraform {
  required_providers {
     azurerm = {
        source  = "hashicorp/azurerm"
        version = ">=3.0"
     }
  }
}

provider "azurerm" {
  features {}
}

variable "prefix" {
  type    = string
  default = "speechquiz"
}

resource "azurerm_resource_group" "rg" {
  name     = "${var.prefix}-rg"
  location = "EastUS"
}

resource "azurerm_storage_account" "st" {
  name                     = "${var.prefix}stg"
  resource_group_name      = azurerm_resource_group.rg.name
  location                 = azurerm_resource_group.rg.location
  account_tier             = "Standard"
  account_replication_type = "LRS"
}

resource "azurerm_storage_container" "audio" {
  name                  = "audio-recordings"
  storage_account_name  = azurerm_storage_account.st.name
  container_access_type = "private"
}

resource "azurerm_key_vault" "kv" {
  name                        = "${var.prefix}-kv"
  location                    = azurerm_resource_group.rg.location
  resource_group_name         = azurerm_resource_group.rg.name
  tenant_id                   = data.azurerm_client_config.current.tenant_id
  sku_name                    = "standard"
  purge_protection_enabled    = false
  soft_delete_enabled         = true
}

data "azurerm_client_config" "current" {}

resource "azurerm_cosmosdb_account" "cosmos" {
  name                = "${var.prefix}-cosmos"
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name
  offer_type          = "Standard"
  kind                = "GlobalDocumentDB"
  consistency_policy {
     consistency_level = "Session"
  }
  geo_location {
     location          = azurerm_resource_group.rg.location
     failover_priority = 0
     
  }
}
# Note: Azure OpenAI resource requires special access; create manually or with provider if allowed.
