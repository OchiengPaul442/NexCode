"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const chai_1 = require("chai");
const providerFactory_1 = require("../../src/providers/providerFactory");
describe("ProviderFactory", () => {
    it("returns an object with streamCompletion that invokes callbacks", (done) => {
        const provider = (0, providerFactory_1.createProviderFromPulseConfig)();
        let tokens = [];
        const controller = provider.streamCompletion("hello", undefined, {
            onConnected: () => { },
            onToken: (t) => tokens.push(t),
            onEnd: () => {
                try {
                    (0, chai_1.expect)(tokens.length).to.be.greaterThan(0);
                    done();
                }
                catch (e) {
                    done(e);
                }
            },
            onError: (err) => done(err),
        });
        // no-op
    });
});
//# sourceMappingURL=providerFactory.test.js.map