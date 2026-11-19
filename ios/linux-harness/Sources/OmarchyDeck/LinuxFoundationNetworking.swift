// Linux only. On Apple platforms URLRequest lives in Foundation; on Linux it lives in FoundationNetworking.
// The app's DeckConfig.swift uses URLRequest without importing it, so the harness re-exports the module here.
#if canImport(FoundationNetworking)
@_exported import FoundationNetworking
#endif
