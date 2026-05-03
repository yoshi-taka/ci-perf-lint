FROM eclipse-temurin:21-jdk AS build
WORKDIR /app
COPY pom.xml ./
RUN mvn dependency:go-offline -B -q
COPY src/ src/
RUN mvn clean package -B -DskipTests
