inline static unsigned wrap_values(signed value, unsigned count) {
	value = value % signed(count);
	if (value < 0) {
		value = count + value;
	}
	return value;
}
