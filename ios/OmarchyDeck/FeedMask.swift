enum FeedMask {
    /// The amount itself, or the one masked form (`DeckMoney.masked`, "$•••") until the owner reveals it.
    static func money(_ text: String, shown: Bool) -> String { shown ? text : DeckMoney.masked }
}
