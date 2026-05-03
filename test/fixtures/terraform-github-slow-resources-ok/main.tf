terraform {
  required_providers {
    github = {
      source  = "integrations/github"
      version = "~> 6.0"
    }
  }
}

resource "github_repository" "main" {
  name       = "repo"
  visibility = "private"
}

resource "github_branch_protection" "main" {
  repository_id = github_repository.main.node_id
  pattern       = "main"
}

resource "github_repository_environment" "staging" {
  repository  = github_repository.main.name
  environment = "staging"
}

resource "github_actions_secret" "api_key" {
  repository      = github_repository.main.name
  secret_name     = "API_KEY"
  plaintext_value = "secret-value"
}
