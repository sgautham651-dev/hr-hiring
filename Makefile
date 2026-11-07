.PHONY: setup test check app model samples status clean

PYTHON := .venv/bin/python

setup:
	bash setup.sh

test:
	$(PYTHON) -m pytest tests -v

check:
	$(PYTHON) run.py check

app:
	./start_app.sh

model:
	./start_model.sh

samples:
	$(PYTHON) run.py samples

status:
	$(PYTHON) run.py status

clean:
	rm -rf .pytest_cache __pycache__ hiring/__pycache__ tests/__pycache__
