// src/viz — protocol visualisation: X-rays of the contract, signatures, transactions, AVL+ proofs and trees, the
// event feed, status and exit clocks, and the /learn/tools. Read VIZ_API.md first. Components take engine objects
// (@/protocol) as props; they never fetch and never keep state outside React.

// contract
export { ContractXray, contentAnnotations, contentReasonLines, codeSpans, commentNear } from "./contract/ContractXray";
export type { ContractXrayProps, XrayAnnotation } from "./contract/ContractXray";
export { buildRows, findingFor, focusChecks, resolveEvaluation, sourceOf, verdictOf, OFFCHAIN_REASON_CHECK } from "./contract/model";
export type { EvaluationInput, XrayRow, XrayVerdict } from "./contract/model";
export { ALL_CHECK_IDS, checksOf, deriveContractMap, expectedChecks } from "./contract/lines";
export type { ActionId, ContractId, ContractMap } from "./contract/lines";

// signatures
export { SignatureXray } from "./signature/SignatureXray";
export type { SignatureXrayProps } from "./signature/SignatureXray";
export { SignLab } from "./signature/SignLab";
export type { SignLabProps } from "./signature/SignLab";
export { SelfTest, runSelfTest } from "./signature/SelfTest";
export { SCHNORR_VECTORS } from "./signature/vectors";
export type { SchnorrVector } from "./signature/vectors";

// transactions
export { TxLens, reserveInputIndex, synthCreateTx, txKindOf } from "./tx/TxLens";
export type { TxKind, TxLensProps } from "./tx/TxLens";
export { CONTEXT_VAR_MEANING, extensionHex, extensionRows, scalaImprove, scalaMapOrder } from "./tx/contextVars";
export type { ExtensionRow, VarMeaning } from "./tx/contextVars";

// AVL+
export { AvlProofViewer, describeAvlValue } from "./avl/AvlProofViewer";
export type { AvlProofViewerProps, AvlValueKind } from "./avl/AvlProofViewer";
export { AvlTreeView } from "./avl/AvlTreeView";
export type { AvlTreeViewProps } from "./avl/AvlTreeView";
export { DigestGlyph } from "./avl/DigestGlyph";
export type { DigestGlyphProps } from "./avl/DigestGlyph";
export { digestGlyph } from "./avl/glyph";
export { proofAnatomy, proofByteSegs, recomputeRootLabel, rootMatches } from "./avl/proof";
export type { ProofAnatomy, ProofSegment } from "./avl/proof";

// feed
export { EventFeed, FeedMarkIcon, FEED_ROW_HEIGHT, FEED_ROW_HEIGHT_TALL } from "./feed/EventFeed";
export type { EventFeedProps } from "./feed/EventFeed";
export { describeLine, EVENT_TYPES, FEED_GROUPS, groupOf, markOf } from "./feed/describe";
export type { DescribeCtx, FeedGroup, FeedLine, FeedMark } from "./feed/describe";

// clocks
export { StatusLadder } from "./clocks/StatusLadder";
export type { StatusLadderProps } from "./clocks/StatusLadder";
export { ExitClocks, DeadManDial } from "./clocks/ExitClocks";
export type { ExitClocksProps } from "./clocks/ExitClocks";
export { emergencyModel, exitModel, ladderFromEconomy, ladderModel } from "./clocks/model";
export type { EmergencyModel, ExitModel, LadderInput, LadderModel } from "./clocks/model";

// tools (/learn/tools)
export { DebtKeyTool, debtKeyParts, checkHexField } from "./tools/DebtKeyTool";
export type { DebtKeyToolProps } from "./tools/DebtKeyTool";
export { MessageBuilder, buildMessage, MESSAGE_LAYOUT, parseAmountInput } from "./tools/MessageBuilder";
export type { MessageBuilderProps, MessageFields } from "./tools/MessageBuilder";
export { NoteVerifyTool, noteMessageOf, parseNoteJson, sampleNoteJson, tv001Json } from "./tools/NoteVerifyTool";
export type { ParsedNote } from "./tools/NoteVerifyTool";
export { TemplateHashTool } from "./tools/TemplateHashTool";
export type { TemplateHashToolProps } from "./tools/TemplateHashTool";
export { analyzeTemplate, KNOWN_TEMPLATES, knownTemplates, SAMPLE_TREES, sha256Hex } from "./tools/template";
export type { KnownTemplate, TemplateAnalysis } from "./tools/template";

// shared
export { FaceToggle, useFace } from "./core/primitives";
export type { Face } from "./core/primitives";
export { LAB_NAMES, LAB_SALT, LAB_TRACKER_NFT, LAB_DEFAULT_TS, labDisplayName, labKey, labNameOf } from "./core/lab";
export type { LabName } from "./core/lab";
