terraform {
  required_providers {
    github = {
      source  = "integrations/github"
      version = "~> 6.0"
    }
  }
}

data "github_repository" "main" {
  full_name = "org/repo"
}

resource "github_repository" "main" {
  name       = "repo"
  visibility = "private"
}

resource "github_branch_protection" "main" {
  repository_id = data.github_repository.main.node_id
  pattern       = "main"
}

resource "github_repository_environment" "staging" {
  repository  = github_repository.main.name
  environment = "staging"
  reviewers {
    users = [data.github_repository.main.node_id]
  }
}

resource "github_actions_secret" "api_key" {
  repository      = github_repository.main.name
  secret_name     = "API_KEY"
  plaintext_value = data.github_repository.main.ssh_clone_url
}
