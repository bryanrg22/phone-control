import FlyingFox
import XCTest
import os

/// Serves the identity of the HOST that started this XCTest session.
///
/// The supervisor (device/supervisor.mjs) puts HOST_NAME / HOST_PLATFORM /
/// HOST_ARMED_ISO into the runner's launch environment with
/// `go-ios runtest --env=…`, and this route returns them, so a caller can tell
/// which host started the session and when. Keys that are unset (the runner was
/// launched by Xcode, say) come back as explicit JSON nulls.
@MainActor
struct HostInfoHandler: HTTPHandler {

    private let logger = Logger(
        subsystem: Bundle.main.bundleIdentifier!,
        category: String(describing: Self.self)
    )

    func handleRequest(_ request: FlyingFox.HTTPRequest) async throws -> HTTPResponse {
        do {
            let env = ProcessInfo.processInfo.environment
            // JSONSerialization + NSNull → explicit nulls for unset keys,
            // so clients always see a stable three-key shape.
            let payload: [String: Any] = [
                "hostName": env["HOST_NAME"] ?? NSNull(),
                "hostPlatform": env["HOST_PLATFORM"] ?? NSNull(),
                "armedISO": env["HOST_ARMED_ISO"] ?? NSNull(),
            ]
            let body = try JSONSerialization.data(withJSONObject: payload)
            return HTTPResponse(statusCode: .ok, body: body)
        } catch let error as AppError {
            return error.httpResponse
        } catch let error {
            return AppError(message: "Error in hostInfo \(error.localizedDescription)").httpResponse
        }
    }
}
