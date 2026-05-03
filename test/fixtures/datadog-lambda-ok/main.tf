resource "aws_lambda_function" "app" {
  filename      = "app.zip"
  function_name = "my-app"
  role          = aws_iam_role.lambda.arn
  handler       = "index.handler"
  runtime       = "nodejs20.x"

  layers = [
    "arn:aws:lambda:us-east-1:464622532012:layer:Datadog-Extension:88",
  ]
}
