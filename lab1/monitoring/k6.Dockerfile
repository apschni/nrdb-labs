FROM golang:1.25.8 AS build
RUN go install go.k6.io/xk6/cmd/xk6@v1.1.0
RUN mkdir -p /out && xk6 build v1.3.0 --with github.com/GhMartingit/xk6-mongo@v1.0.3 --output /out/k6

FROM scratch
COPY --from=build /out/k6 /k6
