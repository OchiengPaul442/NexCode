import { expect } from "chai";
import { createProviderFromPulseConfig } from "../../src/providers/providerFactory";

describe("ProviderFactory", () => {
  it("returns an object with streamCompletion that invokes callbacks", (done) => {
    const provider = createProviderFromPulseConfig();
    let tokens: string[] = [];
    const controller = provider.streamCompletion("hello", undefined, {
      onConnected: () => {},
      onToken: (t: string) => tokens.push(t),
      onEnd: () => {
        try {
          expect(tokens.length).to.be.greaterThan(0);
          done();
        } catch (e) {
          done(e as any);
        }
      },
      onError: (err: any) => done(err),
    });
    // no-op
  });
});
