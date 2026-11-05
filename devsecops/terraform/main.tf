terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

variable "aws_region" {
  description = "AWS region used by the existing inventory environment"
  type        = string
  default     = "ap-southeast-2"
}

provider "aws" {
  region = var.aws_region
}

data "aws_caller_identity" "current" {}

output "aws_account_id" {
  description = "AWS account running this Terraform configuration"
  value       = data.aws_caller_identity.current.account_id
}
