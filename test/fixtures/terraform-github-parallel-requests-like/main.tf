terraform {
  required_providers {
    github = {
      source  = "integrations/github"
      version = "~> 6.0"
    }
  }
}

provider "github" {
  base_url = "https://github.example.com/api/v3/"
  token    = var.github_token
}

provider "github" {
  alias    = "secondary"
  base_url = "https://github.example.com/api/v3/"
  token    = var.github_token
}
