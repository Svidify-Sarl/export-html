#!/usr/bin/env bash

curl -X POST -H "Accept: application/json" -H "Content-type: application/json" -H "Authorization: Bearer ${EXPORT_HTML_BEARER_TOKEN:?set EXPORT_HTML_BEARER_TOKEN}" -d '{
    "html": "<b>hello world <img src=\"https://www.placebear.com/400/300\"/></b>"
}' 'http://localhost:2305/1/pdf' --output test.pdf

curl -X POST -H "Accept: application/json" -H "Content-type: application/json" -H "Authorization: Bearer ${EXPORT_HTML_BEARER_TOKEN:?set EXPORT_HTML_BEARER_TOKEN}" -d '{
    "html": "<b>hello world <img src=\"https://www.placebear.com/400/300\"/></b>"
}' 'http://localhost:2305/1/screenshot' --output test.png

curl -X POST -H "Accept: application/json" -H "Content-type: application/json" -H "Authorization: Bearer ${EXPORT_HTML_BEARER_TOKEN:?set EXPORT_HTML_BEARER_TOKEN}" -d '{
    "url": "https://news.ycombinator.com/"
}' 'http://localhost:2305/1/screenshot' --output hackernews.png

curl -X POST -H "Accept: application/json" -H "Content-type: application/json" -H "Authorization: Bearer ${EXPORT_HTML_BEARER_TOKEN:?set EXPORT_HTML_BEARER_TOKEN}" -d '{
    "url": "https://news.ycombinator.com/"
}' 'http://localhost:2305/1/pdf' --output hackernews.pdf

