# lifts — shell shortcuts
# Auto-sourced when you cd into this directory (via ~/.haunt/shell-init.sh)

_compose() {
  if [ -f .env.secrets ]; then
    op run --no-masking --env-file=.env.secrets -- docker compose "$@"
  else
    docker compose "$@"
  fi
}

alias dcup="_compose up"
alias dcdn="_compose down"
alias dclogs="_compose logs -f"
alias dcbuild="_compose build"
alias dcrestart="_compose down && _compose up"

# Repo-specific shortcuts
alias dcrw="_compose run --rm web"

if [[ $- == *i* ]]; then
  echo ""
  echo "  lifts"
  echo ""
  echo "  http://localhost:4760  Web"
  echo ""
  echo "  dcup · dcdn · dclogs · dcbuild · dcrestart"
  echo "  dcrw  Run a command in the web container"
  echo ""
fi
