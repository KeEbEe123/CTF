from __future__ import annotations

import base64
from pathlib import Path

from scapy.all import DNS, DNSQR, DNSRR, Ether, ICMP, IP, Raw, TCP, UDP, rdpcap, wrpcap


FLAG_BASE64 = "Q1RGe2h0dHBfcGFja2V0fQ=="
OUTPUT_PCAP = Path(__file__).with_name("network_capture.pcap")

# Simulated hosts
CLIENT_IP = "10.10.10.20"
DNS_IP = "10.10.10.53"
WEB_IP = "10.10.10.5"
GATEWAY_IP = "10.10.10.1"

CLIENT_MAC = "02:42:0a:0a:0a:14"
DNS_MAC = "02:42:0a:0a:0a:35"
WEB_MAC = "02:42:0a:0a:0a:05"
GATEWAY_MAC = "02:42:0a:0a:0a:01"

HTTP_SPORT = 49532
HTTP_DPORT = 80


def _http_request(path: str, host: str = "training.lab", user_agent: str = "Mozilla/5.0") -> bytes:
    return (
        f"GET {path} HTTP/1.1\r\n"
        f"Host: {host}\r\n"
        f"User-Agent: {user_agent}\r\n"
        "Accept: */*\r\n"
        "Connection: keep-alive\r\n"
        "\r\n"
    ).encode("ascii")


def _http_response(body: str, content_type: str = "text/plain", code: str = "200 OK") -> bytes:
    payload = body.encode("utf-8")
    headers = (
        f"HTTP/1.1 {code}\r\n"
        f"Content-Type: {content_type}\r\n"
        f"Content-Length: {len(payload)}\r\n"
        "Server: training-lab/1.0\r\n"
        "Connection: keep-alive\r\n"
        "\r\n"
    ).encode("ascii")
    return headers + payload


def build_packets() -> list:
    packets = []

    seq_c = 1000
    seq_s = 5000

    # 1) DNS request: training.lab
    packets.append(
        Ether(src=CLIENT_MAC, dst=DNS_MAC)
        / IP(src=CLIENT_IP, dst=DNS_IP)
        / UDP(sport=53010, dport=53)
        / DNS(id=0x1001, rd=1, qd=DNSQR(qname="training.lab"))
    )

    # 2) DNS response: training.lab -> 10.10.10.5
    packets.append(
        Ether(src=DNS_MAC, dst=CLIENT_MAC)
        / IP(src=DNS_IP, dst=CLIENT_IP)
        / UDP(sport=53, dport=53010)
        / DNS(
            id=0x1001,
            qr=1,
            aa=1,
            rd=1,
            ra=1,
            qd=DNSQR(qname="training.lab"),
            an=DNSRR(rrname="training.lab", type="A", ttl=300, rdata=WEB_IP),
        )
    )

    # 3-5) TCP handshake
    packets.append(
        Ether(src=CLIENT_MAC, dst=WEB_MAC)
        / IP(src=CLIENT_IP, dst=WEB_IP)
        / TCP(sport=HTTP_SPORT, dport=HTTP_DPORT, flags="S", seq=seq_c)
    )
    seq_c += 1

    packets.append(
        Ether(src=WEB_MAC, dst=CLIENT_MAC)
        / IP(src=WEB_IP, dst=CLIENT_IP)
        / TCP(sport=HTTP_DPORT, dport=HTTP_SPORT, flags="SA", seq=seq_s, ack=seq_c)
    )
    seq_s += 1

    packets.append(
        Ether(src=CLIENT_MAC, dst=WEB_MAC)
        / IP(src=CLIENT_IP, dst=WEB_IP)
        / TCP(sport=HTTP_SPORT, dport=HTTP_DPORT, flags="A", seq=seq_c, ack=seq_s)
    )

    # 6-9) Normal HTTP /index.html
    req_index = _http_request("/index.html", user_agent="Mozilla/5.0 (Windows NT 10.0)")
    packets.append(
        Ether(src=CLIENT_MAC, dst=WEB_MAC)
        / IP(src=CLIENT_IP, dst=WEB_IP)
        / TCP(sport=HTTP_SPORT, dport=HTTP_DPORT, flags="PA", seq=seq_c, ack=seq_s)
        / Raw(load=req_index)
    )
    seq_c += len(req_index)

    packets.append(
        Ether(src=WEB_MAC, dst=CLIENT_MAC)
        / IP(src=WEB_IP, dst=CLIENT_IP)
        / TCP(sport=HTTP_DPORT, dport=HTTP_SPORT, flags="A", seq=seq_s, ack=seq_c)
    )

    resp_index = _http_response("<html><body>Welcome to training.lab</body></html>", "text/html")
    packets.append(
        Ether(src=WEB_MAC, dst=CLIENT_MAC)
        / IP(src=WEB_IP, dst=CLIENT_IP)
        / TCP(sport=HTTP_DPORT, dport=HTTP_SPORT, flags="PA", seq=seq_s, ack=seq_c)
        / Raw(load=resp_index)
    )
    seq_s += len(resp_index)

    packets.append(
        Ether(src=CLIENT_MAC, dst=WEB_MAC)
        / IP(src=CLIENT_IP, dst=WEB_IP)
        / TCP(sport=HTTP_SPORT, dport=HTTP_DPORT, flags="A", seq=seq_c, ack=seq_s)
    )

    # 10-12) Normal HTTP /status
    req_status = _http_request("/status", user_agent="python-requests/2.31")
    packets.append(
        Ether(src=CLIENT_MAC, dst=WEB_MAC)
        / IP(src=CLIENT_IP, dst=WEB_IP)
        / TCP(sport=HTTP_SPORT, dport=HTTP_DPORT, flags="PA", seq=seq_c, ack=seq_s)
        / Raw(load=req_status)
    )
    seq_c += len(req_status)

    resp_status = _http_response('{"service":"ok","uptime":"12h"}', "application/json")
    packets.append(
        Ether(src=WEB_MAC, dst=CLIENT_MAC)
        / IP(src=WEB_IP, dst=CLIENT_IP)
        / TCP(sport=HTTP_DPORT, dport=HTTP_SPORT, flags="PA", seq=seq_s, ack=seq_c)
        / Raw(load=resp_status)
    )
    seq_s += len(resp_status)

    packets.append(
        Ether(src=CLIENT_MAC, dst=WEB_MAC)
        / IP(src=CLIENT_IP, dst=WEB_IP)
        / TCP(sport=HTTP_SPORT, dport=HTTP_DPORT, flags="A", seq=seq_c, ack=seq_s)
    )

    # 13-15) Suspicious HTTP request containing Base64 flag
    req_flag = _http_request(
        f"/api/data?msg={FLAG_BASE64}",
        host="training.lab",
        user_agent="curl/7.79",
    )
    packets.append(
        Ether(src=CLIENT_MAC, dst=WEB_MAC)
        / IP(src=CLIENT_IP, dst=WEB_IP)
        / TCP(sport=HTTP_SPORT, dport=HTTP_DPORT, flags="PA", seq=seq_c, ack=seq_s)
        / Raw(load=req_flag)
    )
    seq_c += len(req_flag)

    resp_flag = _http_response('{"result":"accepted"}', "application/json")
    packets.append(
        Ether(src=WEB_MAC, dst=CLIENT_MAC)
        / IP(src=WEB_IP, dst=CLIENT_IP)
        / TCP(sport=HTTP_DPORT, dport=HTTP_SPORT, flags="PA", seq=seq_s, ack=seq_c)
        / Raw(load=resp_flag)
    )
    seq_s += len(resp_flag)

    packets.append(
        Ether(src=CLIENT_MAC, dst=WEB_MAC)
        / IP(src=CLIENT_IP, dst=WEB_IP)
        / TCP(sport=HTTP_SPORT, dport=HTTP_DPORT, flags="A", seq=seq_c, ack=seq_s)
    )

    # 16-17) Harmless ICMP traffic
    packets.append(
        Ether(src=CLIENT_MAC, dst=GATEWAY_MAC)
        / IP(src=CLIENT_IP, dst=GATEWAY_IP)
        / ICMP(type=8, id=0x1200, seq=1)
        / Raw(load=b"health-check")
    )
    packets.append(
        Ether(src=GATEWAY_MAC, dst=CLIENT_MAC)
        / IP(src=GATEWAY_IP, dst=CLIENT_IP)
        / ICMP(type=0, id=0x1200, seq=1)
        / Raw(load=b"health-check")
    )

    # 18-19) Extra DNS noise
    packets.append(
        Ether(src=CLIENT_MAC, dst=DNS_MAC)
        / IP(src=CLIENT_IP, dst=DNS_IP)
        / UDP(sport=53011, dport=53)
        / DNS(id=0x1002, rd=1, qd=DNSQR(qname="updates.training.lab"))
    )
    packets.append(
        Ether(src=DNS_MAC, dst=CLIENT_MAC)
        / IP(src=DNS_IP, dst=CLIENT_IP)
        / UDP(sport=53, dport=53011)
        / DNS(
            id=0x1002,
            qr=1,
            rd=1,
            ra=1,
            rcode=3,
            qd=DNSQR(qname="updates.training.lab"),
        )
    )

    # 20-22) Graceful TCP close
    packets.append(
        Ether(src=CLIENT_MAC, dst=WEB_MAC)
        / IP(src=CLIENT_IP, dst=WEB_IP)
        / TCP(sport=HTTP_SPORT, dport=HTTP_DPORT, flags="FA", seq=seq_c, ack=seq_s)
    )
    seq_c += 1

    packets.append(
        Ether(src=WEB_MAC, dst=CLIENT_MAC)
        / IP(src=WEB_IP, dst=CLIENT_IP)
        / TCP(sport=HTTP_DPORT, dport=HTTP_SPORT, flags="FA", seq=seq_s, ack=seq_c)
    )
    seq_s += 1

    packets.append(
        Ether(src=CLIENT_MAC, dst=WEB_MAC)
        / IP(src=CLIENT_IP, dst=WEB_IP)
        / TCP(sport=HTTP_SPORT, dport=HTTP_DPORT, flags="A", seq=seq_c, ack=seq_s)
    )

    return packets


def verify_pcap(pcap_path: Path) -> None:
    capture = rdpcap(str(pcap_path))
    packet_count = len(capture)
    raw_bytes = b"".join(bytes(packet) for packet in capture)
    occurrences = raw_bytes.count(FLAG_BASE64.encode("ascii"))

    http_packets = 0
    for packet in capture:
        if packet.haslayer(TCP) and packet.haslayer(Raw):
            tcp_layer = packet[TCP]
            payload = bytes(packet[Raw].load)
            if (tcp_layer.sport == 80 or tcp_layer.dport == 80) and (
                payload.startswith(b"GET ") or payload.startswith(b"HTTP/1.1 ")
            ):
                http_packets += 1

    decoded = base64.b64decode(FLAG_BASE64).decode("utf-8")
    print(f"PCAP path: {pcap_path}")
    print(f"Packet count: {packet_count}")
    print(f"HTTP packets (Wireshark filter http should match these): {http_packets}")
    print(f"Base64 occurrence count: {occurrences}")
    print(f"Decoded Base64 value: {decoded}")


def main() -> None:
    packets = build_packets()
    wrpcap(str(OUTPUT_PCAP), packets)
    verify_pcap(OUTPUT_PCAP)


if __name__ == "__main__":
    main()
