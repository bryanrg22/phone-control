import Foundation

struct DragRequest: Decodable {
    let startX: Double
    let startY: Double
    let endX: Double
    let endY: Double
    let holdDuration: Double   // seconds to hold before dragging (long press)
    let dragDuration: Double   // seconds for the drag movement
}
