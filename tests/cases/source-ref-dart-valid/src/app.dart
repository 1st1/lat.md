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

Greeter createGreeter(String prefix) {
  return Greeter(prefix);
}

mixin Greeting {
  String hello() => 'Hi there!';
}

final defaultName = 'World';

enum Color { red, green, blue }
