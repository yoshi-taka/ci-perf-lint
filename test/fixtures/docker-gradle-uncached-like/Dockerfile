FROM eclipse-temurin:21-jdk AS build
WORKDIR /app
COPY build.gradle ./
RUN gradle dependencies --no-daemon --stacktrace
COPY src/ src/
RUN gradle build -x test --no-daemon --stacktrace
