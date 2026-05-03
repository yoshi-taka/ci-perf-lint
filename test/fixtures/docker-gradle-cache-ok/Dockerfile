FROM eclipse-temurin:21-jdk AS build
ENV GRADLE_USER_HOME=/cache/.gradle
WORKDIR /app
COPY build.gradle ./
RUN --mount=type=cache,target=/cache/.gradle \
    gradle dependencies --no-daemon --stacktrace
COPY src/ src/
RUN --mount=type=cache,target=/cache/.gradle \
    gradle build -x test --no-daemon --stacktrace --build-cache
