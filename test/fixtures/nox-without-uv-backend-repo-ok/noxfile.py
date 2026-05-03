import nox

nox.options.uv = True

@nox.session
def test(session):
    session.install("pytest")
    session.run("pytest")
