FROM eclipse-temurin:21-jdk AS build
WORKDIR /app
COPY pom.xml ./
RUN --mount=type=cache,target=/root/.m2 \
    mvn dependency:go-offline -B -q
COPY src/ src/
RUN --mount=type=cache,target=/root/.m2 \
    mvn clean package -B -DskipTests
