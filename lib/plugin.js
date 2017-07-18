const BrowserStack = require('browserstack');
const BrowserStackTunnel = require('browserstacktunnel-wrapper');
const cleankill = require('cleankill');
const BrowserRunner = require('web-component-tester-custom-runner').BrowserRunner;

function getBrowserStackCredentials(pluginOptions) {
  return {
    username: process.env.BROWSER_STACK_USERNAME || pluginOptions.username,
    accessKey: process.env.BROWSER_STACK_ACCESS_KEY || pluginOptions.accessKey
  };
}

function createBrowserStackTunnel(emitter, pluginOptions) {
  return new Promise((resolve, reject) => {
    const tunnel = pluginOptions.tunnel = pluginOptions.tunnel || {};
    tunnel.key = getBrowserStackCredentials(pluginOptions).accessKey;
    tunnel.localIdentifier = tunnel.localIdentifier || 'wct' + Math.random();

    tunnel.inst = new BrowserStackTunnel(tunnel);
    tunnel.inst.start(error => {
      if (error) {
        emitter.emit('log:warn', 'browserstack: Failed to establish tunnel', error.toString());
        reject(error);
      } else {
        emitter.emit('log:debug', 'browserstack: Tunnel established');
        resolve();
      }
    });

    function kill(done) {
      tunnel.inst.stop(error => {
        if (error) {
          emitter.emit('log:warn', 'browserstack: Failed to stop tunnel', error.toString());
        }

        done();
      });
    }

    emitter.on('run-end', kill);
    cleankill.onInterrupt(() => {
      return new Promise(resolve => {
        kill(resolve);
      });
    })
  });
}

function createBrowserStackClient(emitter, pluginOptions) {
  const clientConfig = pluginOptions.client = pluginOptions.client || {};
  const credentials = getBrowserStackCredentials(pluginOptions);
  clientConfig.username = credentials.username;
  clientConfig.password = credentials.accessKey;

  const client = BrowserStack.createClient(clientConfig);
  return client;
}

class BrowserstackBrowserRunner extends BrowserRunner {
  constructor(emitter, def, options, url, waitFor) {
    super(emitter, def, options, url, waitFor);
  }

  initBrowser() {
    this.browser = {
      id: undefined
    };
  }

  attachBrowser() {
    return new Promise((resolve, reject) => {
      const settings = Object.assign({}, this.def);
      delete settings.wct;
      settings.url = this.testUrl;

      this.def.wct.client.createWorker(settings, (error, worker) => {
        if (error) {
          reject(error);
        } else {
          this.emitter.emit('log:debug', 'browserstack: createWorker', worker);
          this.browser = worker;
          this.def.wct.client.getWorker(worker.id, (error, updatedWorker) => {
            if (error) {
              this.emitter.emit('log:warn', 'browserstack: Failed to get worker session', error.toString());
              resolve();
            } else {
              this.browser = updatedWorker;
              this.sessionId = updatedWorker.browser_url.split('/').slice(-1)[0];
              this.emitter.emit('log:info', 'browserstack: ' + this.def.browserName + ' session at ' + updatedWorker.browser_url);
              resolve();
            }
          });

          resolve();
        }
      });
    });
  }

  quitBrowser(browser) {
    return new Promise((resolve, reject) => {
      this.def.wct.client.terminateWorker(browser.id, error => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }
}

module.exports = (wct, pluginOptions) => {
  let client;
  pluginOptions.browsers.forEach(browser => {
    browser.runnerCtor = BrowserstackBrowserRunner;
  });

  wct.hook('configure', done => {
    if (!pluginOptions.browsers || !pluginOptions.browsers.length) {
      return done();
    }

    const defaults = pluginOptions.defaults = pluginOptions.defaults || {};
    defaults.browser_version = defaults.browser_version || 'latest';
    defaults.name = defaults.name || 'WCT test';
    defaults.build = defaults.build ||
      process.env.BUILD_NUMBER ||
      process.env.BUILD_TAG ||
      process.env.CI_BUILD_NUMBER ||
      process.env.CI_BUILD_TAG ||
      process.env.TRAVIS_BUILD_NUMBER ||
      process.env.CIRCLE_BUILD_NUM ||
      process.env.DRONE_BUILD_NUMBER;

    client = createBrowserStackClient(wct, pluginOptions);
    pluginOptions.browsers = pluginOptions.browsers.map(browser => {
      // Give client access to BrowserstackBrowserRunner instance
      browser.wct = {
        client
      };

      // Copy Browserstack-specific keys to WD keys for WCT
      browser.browserName = browser.browserName || browser.browser;
      browser.version = browser.version || browser.browser_version;
      browser.platform = browser.platform || browser.os;

      return Object.assign({}, defaults, browser);
    });

    const activeBrowsers = wct.options.activeBrowsers;
    activeBrowsers.push.apply(activeBrowsers, pluginOptions.browsers);

    done();
  });

  wct.hook('prepare', done => {
    if (!pluginOptions.browsers || !pluginOptions.browsers.length) {
      return done();
    }

    wct.emitHook('prepare:browserstack-tunnel', error => {
      if (error) {
        return done(error);
      }

      createBrowserStackTunnel(wct, pluginOptions).then(() => {
        pluginOptions.browsers.forEach(browser => {
          browser.tunnelIdentifier = pluginOptions.tunnel.localIdentifier;
          browser['browserstack.tunnel'] = true;
        });

        return done();
      }).catch(error => {
        return done(error);
      });
    });
  });

  wct.on('browser-end', (def, error, stats, sessionId) => {
    if (!pluginOptions.browsers || !pluginOptions.browsers.length) {
      return;
    }

    if (sessionId) {
      const payload = {
        status: (stats.status === 'complete' && stats.failing === 0) ? 'completed': 'error'
      };

      wct.emit('log:debug', 'browserstack: Updating session', sessionId, payload);
      const credentials = getBrowserStackCredentials(pluginOptions);
      const automateClient = BrowserStack.createAutomateClient({
        username: credentials.username,
        password: credentials.accessKey
      });

      automateClient.updateSession(sessionId, payload, (error) => {
        if (error) {
          wct.emit('log:warn', 'browserstack: Failed to update session', error.toString());
        }
      });
    }
  });
};
