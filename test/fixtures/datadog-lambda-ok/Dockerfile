FROM public.ecr.aws/datadog/lambda-extension:88 AS extension
FROM public.ecr.aws/lambda/nodejs:20
COPY --from=extension /opt/extensions/ /opt/extensions/
COPY app.js /var/task/
