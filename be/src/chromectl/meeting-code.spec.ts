import { InvalidMeetingError, parseMeeting } from './meeting-code';

describe('parseMeeting', () => {
  it.each([
    'abc-defg-hij',
    'ABC-DEFG-HIJ',
    'abcdefghij',
    'meet.google.com/abc-defg-hij',
    'https://meet.google.com/abc-defg-hij?authuser=0&hs=122',
    'http://meet.google.com/abc-defg-hij#x',
    '  https://meet.google.com/abc-defg-hij  ',
    'HTTPS://MEET.GOOGLE.COM/ABC-DEFG-HIJ',
  ])('accepts %p', (input) => {
    expect(parseMeeting(input)).toEqual({
      meetingCode: 'abc-defg-hij',
      meetingUrl: 'https://meet.google.com/abc-defg-hij',
    });
  });

  it.each([
    '',
    '   ',
    'a'.repeat(201),
    'abc-defg-hij; reboot',
    '$(reboot)',
    '`id`',
    'abc-defg-hij && rm -rf /',
    '--headless',
    '-abc-defg-hij',
    'https://evil.com/abc-defg-hij',
    'https://meet.google.com.evil.com/abc-defg-hij',
    'https://evil.com/?u=meet.google.com/abc-defg-hij',
    'https://meet.google.com/abc-defg-hij/extra',
    'https://meet.google.com/lookup/abc',
    'https://meet.google.com/my-room',
    'javascript:alert(1)',
    'file:///etc/passwd',
    'ftp://meet.google.com/abc-defg-hij',
    'аbc-defg-hij',
    'abc-defg-hi',
    'abc_defg_hij',
  ])('refuses %p', (input) => {
    expect(() => parseMeeting(input)).toThrow(InvalidMeetingError);
  });

  it('builds the URL only from the code and never from the input', () => {
    const { meetingUrl } = parseMeeting(
      'http://user:pw@meet.google.com:8080/ABCDEFGHIJ?next=https://evil.com',
    );
    expect(meetingUrl).toBe('https://meet.google.com/abc-defg-hij');
  });

  it('gives a clear message with the input cut to 60 characters', () => {
    const input = 'x'.repeat(100);
    expect(() => parseMeeting(input)).toThrow(
      `Not a Google Meet meeting: "${'x'.repeat(60)}". ` +
        'Use a link like https://meet.google.com/abc-defg-hij or a code like abc-defg-hij.',
    );
  });
});
