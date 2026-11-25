from nori_policy import Policy
p=Policy(["plan","read_status","erase_disk"])
assert p.decide("plan").allowed
assert p.decide("erase_disk").requires_approval
assert p.decide("erase_disk", approved=True).allowed
assert not p.decide("control_vehicle").allowed
print("NORI permission contract passed")
