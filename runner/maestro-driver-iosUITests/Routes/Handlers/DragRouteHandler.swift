import FlyingFox
import XCTest
import os

@MainActor
struct DragRouteHandler: HTTPHandler {
    private let logger = Logger(
        subsystem: Bundle.main.bundleIdentifier!,
        category: String(describing: Self.self)
    )

    func handleRequest(_ request: FlyingFox.HTTPRequest) async throws -> FlyingFox.HTTPResponse {
        guard let requestBody = try? await JSONDecoder().decode(DragRequest.self, from: request.bodyData) else {
            return AppError(type: .precondition, message: "Incorrect request body for drag handler").httpResponse
        }

        let (width, height) = ScreenSizeHelper.physicalScreenSize()
        let startPoint = ScreenSizeHelper.orientationAwarePoint(
            width: width,
            height: height,
            point: CGPoint(x: requestBody.startX, y: requestBody.startY)
        )
        let endPoint = ScreenSizeHelper.orientationAwarePoint(
            width: width,
            height: height,
            point: CGPoint(x: requestBody.endX, y: requestBody.endY)
        )

        let description = "Drag from (\(Int(requestBody.startX)), \(Int(requestBody.startY))) to (\(Int(requestBody.endX)), \(Int(requestBody.endY))) hold=\(requestBody.holdDuration)s drag=\(requestBody.dragDuration)s"
        logger.info("\(description)")

        do {
            let eventTarget = EventTarget()
            try await eventTarget.dispatchEvent(description: description) {
                EventRecord(orientation: .portrait)
                    .addDragEvent(
                        start: startPoint,
                        end: endPoint,
                        holdDuration: requestBody.holdDuration,
                        dragDuration: requestBody.dragDuration
                    )
            }
            return HTTPResponse(statusCode: .ok)
        } catch {
            logger.error("Drag failed: \(error.localizedDescription)")
            return AppError(message: "Drag failed: \(error.localizedDescription)").httpResponse
        }
    }
}
