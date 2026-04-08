String greet(String name) {
  return 'Hello, $name!';
}

class Greeter {
  final String prefix;

  Greeter(this.prefix);

  String greet(String name) {
    return '$prefix $name!';
  }
}

final defaultName = 'World';
