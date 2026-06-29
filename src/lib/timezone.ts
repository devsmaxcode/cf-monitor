export const appTimeZone = 'Asia/Dhaka'

const datePartsFormatter = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  hour: '2-digit',
  hourCycle: 'h23',
  minute: '2-digit',
  month: '2-digit',
  timeZone: appTimeZone,
  year: 'numeric',
})

export type AppTimeParts = {
  day: number
  hour: number
  minute: number
  month: number
  year: number
}

export function appTimeParts(date: Date): AppTimeParts {
  const values = Object.fromEntries(
    datePartsFormatter
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  )

  return {
    day: values.day || 0,
    hour: values.hour || 0,
    minute: values.minute || 0,
    month: values.month || 0,
    year: values.year || 0,
  }
}

export function appTimeSort(parts: AppTimeParts) {
  return (
    parts.year * 100000000 +
    parts.month * 1000000 +
    parts.day * 10000 +
    parts.hour * 100 +
    parts.minute
  )
}

export function appTimeKey(parts: AppTimeParts) {
  return [
    parts.year,
    String(parts.month).padStart(2, '0'),
    String(parts.day).padStart(2, '0'),
    String(parts.hour).padStart(2, '0'),
    String(parts.minute).padStart(2, '0'),
  ].join('-')
}

export function appDateLabel(date: Date) {
  return date.toLocaleDateString('en-US', {
    day: 'numeric',
    month: 'short',
    timeZone: appTimeZone,
  })
}

export function appTimeLabel(
  date: Date,
  options: Intl.DateTimeFormatOptions = {},
) {
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: appTimeZone,
    ...options,
  })
}

export function appDateTimeLabel(date: Date) {
  return date.toLocaleString('en-US', {
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    month: 'short',
    timeZone: appTimeZone,
    year: 'numeric',
  })
}
