FROM golang:1.25 AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN go build -o /bin/app ./cmd/server

FROM alpine:3.22
COPY --from=build /bin/app /bin/app
CMD ["/bin/app"]
