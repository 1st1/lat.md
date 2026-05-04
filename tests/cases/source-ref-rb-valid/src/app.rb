def greet(name)
  "Hello, #{name}!"
end

class Greeter
  def greet(name)
    "Hi, #{name}!"
  end

  def self.create(name)
    new(name)
  end
end

module Helpers
  def assist(name)
    "Helping #{name}!"
  end
end

DEFAULT_NAME = "World"
