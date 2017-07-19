Browserstack support for [web-component-tester](https://github.com/Polymer/web-component-tester).

This plugin is intended to be used with [web-component-tester-custom-runner](https://www.npmjs.com/package/web-component-tester-custom-runner) until support for custom runners is added to WCT. It is experimental and a proof of concept, use at your own risk!

## Authentication

Browserstack username and access key may be set in config or via environment variables `BROWSER_STACK_USERNAME` and `BROWSER_STACK_ACCESS_KEY`.

## Sample wct.conf.js

```js
module.exports = {
  plugins: {
    sauce: { disabled: true },
    browserstack: {
      browsers: [{
        username: 'myusername',
        accessKey: 'myaccesskey',
        browsers: [{
          browser: 'chrome',
          browser_version: 'latest',
          os: 'windows',
          os_version: '10'
        }],
        defaults: {
          project: 'my-project',
          video: false
        }
      }]
    }
  }
};
```
