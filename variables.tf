variable "rg_name" {
  type    = string
  default = "sg01-tf-rg"
}

variable "location" {
  type    = string
  default = "canadacentral"
}

variable "prefix" {
  type    = string
  default = "dev"
}

variable "vm_name_prefix" {
  type    = string
  default = "vm"
}

variable "subnet_name_prefix" {
  type    = string
  default = "subnet"
}

variable "nic_name_prefix" {
  type    = string
  default = "nic"
}


variable "vnet_name_prefix" {
  type    = string
  default = "vnet"
}
variable "storage_account_name_prefix" {
  type    = string
  default = "stg"
}

locals {
  vm_name = lower("${var.vm_name_prefix}${random_string.storage_suffix.result}")
  subnet_name = lower("${var.subnet_name_prefix}${random_string.storage_suffix.result}")
  nic_name = lower("${var.nic_name_prefix}${random_string.storage_suffix.result}")
  vnet_name = lower("${var.vnet_name_prefix}${random_string.storage_suffix.result}")
  storage_account_name = lower("${var.storage_account_name_prefix}${random_string.storage_suffix.result}")
}