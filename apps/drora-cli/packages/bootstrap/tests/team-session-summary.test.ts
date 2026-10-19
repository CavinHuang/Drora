import {describe,expect,it} from "vitest";
import {ProductProjection} from "../src/drora-protocol-v4/index.js";
import {SessionsIndexProjection,deriveSessionSummary} from "../src/drora-protocol-v4/sessions-index-projection.js";
import {teamProjectionStateSchema} from "@drora/shared/drora-protocol-v4";

describe("team session-index summary",()=>{
  it("emits changes even when phase and activity time stay unchanged, and removes stale summaries",()=>{
    const snapshot=new ProductProjection("lead", "epoch").getSnapshot();
    snapshot.team=teamProjectionStateSchema.parse({teamId:"team",status:"active",name:"test",members:[],mailboxTail:[],board:{limit:100,tasks:[]}});
    const extra={createdAt:1,lastActivityAt:2};
    const index=new SessionsIndexProjection("workspace","epoch");
    expect(deriveSessionSummary(snapshot,{...extra,workspaceId:"workspace"}).teamActivity?.status).toBe("active");
    expect(index.upsertFromConversation(snapshot,extra)).toHaveLength(1);
    expect(index.upsertFromConversation(snapshot,extra)).toEqual([]);
    snapshot.team={...snapshot.team,status:"halted"};
    expect(index.upsertFromConversation(snapshot,extra)).toHaveLength(1);
    delete snapshot.team;
    const removal=index.upsertFromConversation(snapshot,extra)[0];
    expect(removal?.op).toBe("session.upserted");
    if(removal?.op==="session.upserted")expect(removal.session.teamActivity).toBeUndefined();
  });
});
