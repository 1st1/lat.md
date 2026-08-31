typedef NameMapper = String Function(String);

const defaultName = 'World';
final fallbackName = 'Friend';
var greetingCount = 0;

@deprecated
String greet(String name) {
  return 'Hello, $name!';
}

class Greeter {
  final String prefix;
  static const separator = ', ';

  Greeter(this.prefix);
  Greeter.named({this.prefix = 'Hello'});

  String greet(String name) {
    return '$prefix$separator$name!';
  }

  String get label => prefix;
  set label(String value) {}
  bool operator ==(Object other) => other is Greeter;
}

mixin Greeting {
  String wave() => 'Hello';
}

extension GreeterFormatting on Greeter {
  String shout() => greet(defaultName).toUpperCase();
}

enum Color {
  red,
  green;

  String get label => name;
}

extension type UserId(int value) {
  String format() => '$value';
}

class DotShorthand {
  Color pick() => .red;
}
