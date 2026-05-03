terraform {
  required_providers {
    pagerduty = {
      source  = "PagerDuty/pagerduty"
      version = ">= 3.32.2"
    }
  }
}

resource "pagerduty_team" "engineering" {
  name        = "Engineering"
  description = "Engineering team"
}

resource "pagerduty_team_membership" "alice" {
  team_id = pagerduty_team.engineering.id
  user_id = "PLACEHOLDER"
  role    = "manager"
}
