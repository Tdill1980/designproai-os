import { afterEach, describe, expect, it, vi } from "vitest";
import { observeAuthSession } from "./observe-auth-session";

function fixture() {
  let event: (name: string, session: any) => void = () => {};
  let finish!: (value: any) => void;
  let fail!: (reason: Error) => void;
  const unsubscribe = vi.fn();
  const receive = vi.fn();
  const auth = {
    getSession: () => new Promise<any>((resolve, reject) => { finish = resolve; fail = reject; }),
    onAuthStateChange: (callback: typeof event) => {
      event = callback;
      return { data: { subscription: { unsubscribe } } };
    },
  };
  const stop = observeAuthSession(auth as any, receive);
  return { receive, unsubscribe, stop, event: (name: string, session: any) => event(name, session),
    finish: (session: any) => finish({ data: { session }, error: null }), fail: () => fail(new Error("offline")) };
}

afterEach(() => vi.useRealTimers());
describe("auth session race recovery", () => {
  it("accepts a fresh sign-in immediately while the initial session read is stuck", async () => {
    vi.useFakeTimers();
    const f = fixture();
    const user = { id: "fresh-user" };
    f.event("SIGNED_IN", { user });
    expect(f.receive).toHaveBeenLastCalledWith({ user, unavailable: false });
    await vi.advanceTimersByTimeAsync(7000);
    expect(f.receive).toHaveBeenCalledTimes(1);
    f.finish(null);
    await Promise.resolve();
    expect(f.receive).toHaveBeenCalledTimes(1);
    f.stop();
  });
  it("does not restore a signed-out user from a late initial read", async () => {
    const f = fixture();
    f.event("SIGNED_OUT", null);
    f.finish({ user: { id: "old-user" } });
    await Promise.resolve();
    expect(f.receive).toHaveBeenCalledTimes(1);
    expect(f.receive).toHaveBeenLastCalledWith({ user: null, unavailable: false });
    f.stop();
  });
  it("reports an unresolved check without granting access, and recovers on a real auth event", async () => {
    vi.useFakeTimers();
    const f = fixture();
    await vi.advanceTimersByTimeAsync(6000);
    expect(f.receive).toHaveBeenLastCalledWith({ user: null, unavailable: true });
    const user = { id: "recovered-user" };
    f.event("INITIAL_SESSION", { user });
    expect(f.receive).toHaveBeenLastCalledWith({ user, unavailable: false });
    f.stop();
  });
  it("reports a failed initial read and stops publishing after unmount", async () => {
    const f = fixture();
    f.fail();
    await Promise.resolve();
    await Promise.resolve();
    expect(f.receive).toHaveBeenLastCalledWith({ user: null, unavailable: true });
    f.stop();
    f.event("SIGNED_IN", { user: { id: "late" } });
    expect(f.receive).toHaveBeenCalledTimes(1);
    expect(f.unsubscribe).toHaveBeenCalledOnce();
  });
});
