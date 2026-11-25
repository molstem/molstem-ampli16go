#pragma once

#include <coroutine>
#include <chrono>
#include <queue>
#include <optional>
#include "FreeRTOS.h"
#include "task.h"
#include "semphr.h"

namespace microtask {

// Type aliases using FreeRTOS ticks
using TickType = TickType_t;
using Duration = std::chrono::milliseconds;

// Forward declarations
class MicrotaskScheduler;
class Task;

// Helper to convert duration to ticks
inline TickType duration_to_ticks(Duration d) {
    return pdMS_TO_TICKS(d.count());
}

// Helper to get current tick count
inline TickType now_ticks() {
    return xTaskGetTickCount();
}

// Coroutine promise type
struct TaskPromise {
    struct YieldAwaiter {
        Duration delay;
        MicrotaskScheduler* scheduler;

        bool await_ready() const noexcept { return false; }
        void await_suspend(std::coroutine_handle<TaskPromise> handle);
        void await_resume() const noexcept {}
    };

    Task get_return_object();
    std::suspend_always initial_suspend() noexcept { return {}; }  // Suspend initially!

    // Final suspend - forward declaration, implemented after MicrotaskScheduler
    auto final_suspend() noexcept;

    void return_void() noexcept {}
    void unhandled_exception() noexcept {}

    YieldAwaiter yield_value(Duration delay) {
        return YieldAwaiter{delay, scheduler};
    }

    MicrotaskScheduler* scheduler = nullptr;
    std::coroutine_handle<TaskPromise> parent_handle = nullptr;
};

// Task handle
class Task {
public:
    using promise_type = TaskPromise;

    Task(std::coroutine_handle<TaskPromise> handle) : handle_(handle) {
        if (handle_) {
            handle_.promise().scheduler = nullptr;
        }
    }

    Task(Task&& other) noexcept : handle_(other.handle_) {
        other.handle_ = nullptr;
    }

    Task& operator=(Task&& other) noexcept {
        if (this != &other) {
            if (handle_) handle_.destroy();
            handle_ = other.handle_;
            other.handle_ = nullptr;
        }
        return *this;
    }

    ~Task() {
        if (handle_) handle_.destroy();
    }

    Task(const Task&) = delete;
    Task& operator=(const Task&) = delete;

    std::coroutine_handle<TaskPromise> handle() const { return handle_; }

    // Release ownership of the handle (caller is responsible for destroying it)
    void release() { handle_ = nullptr; }

    // Support co_await on Task - forward declaration, implemented after MicrotaskScheduler
    auto operator co_await();

private:
    std::coroutine_handle<TaskPromise> handle_;
};

inline Task TaskPromise::get_return_object() {
    return Task{std::coroutine_handle<TaskPromise>::from_promise(*this)};
}

// Scheduled task entry
struct ScheduledTask {
    TickType wake_tick;
    std::coroutine_handle<TaskPromise> handle;

    bool operator>(const ScheduledTask& other) const {
        // Handle tick overflow correctly
        // If difference is negative (considering overflow), wake_tick is "earlier"
        TickType diff = other.wake_tick - wake_tick;
        return diff > (TickType)(-1) / 2; // Min-heap: earliest time first
    }
};

// Main scheduler class
class MicrotaskScheduler {
public:
    explicit MicrotaskScheduler()
        {

        mutex_ = xSemaphoreCreateMutex();
        wake_semaphore_ = xSemaphoreCreateBinary();

        if (!mutex_ || !wake_semaphore_) {
            if (mutex_) vSemaphoreDelete(mutex_);
            if (wake_semaphore_) vSemaphoreDelete(wake_semaphore_);
        }
    }

    ~MicrotaskScheduler() {
        if (mutex_) vSemaphoreDelete(mutex_);
        if (wake_semaphore_) vSemaphoreDelete(wake_semaphore_);
    }


    // Queue a coroutine task (thread-safe, can be called from any thread)
    void queue_task(Task&& task) {
        auto handle = task.handle();
        if (!handle) return;

        // IMPORTANT: Release ownership from the Task object so it doesn't destroy the handle
        // The scheduler now owns the coroutine handle lifetime
        task.release();

        // Set the scheduler pointer in the promise BEFORE starting
        handle.promise().scheduler = this;

        schedule_task(handle, now_ticks());
    }

    // Internal: schedule a task to resume at a specific tick (thread-safe)
    void schedule_task(std::coroutine_handle<TaskPromise> handle, TickType wake_tick) {
        xSemaphoreTake(mutex_, portMAX_DELAY);
        task_queue_.push(ScheduledTask{wake_tick, handle});
        xSemaphoreGive(mutex_);

        // Wake up the scheduler in case it's waiting
        xSemaphoreGive(wake_semaphore_);
    }

    void scheduler_loop() {
        for(;;) {
            std::optional<ScheduledTask> next_task;

            // Get the next task (thread-safe)
            xSemaphoreTake(mutex_, portMAX_DELAY);
            if (!task_queue_.empty()) {
                next_task = task_queue_.top();
                task_queue_.pop();
            }
            xSemaphoreGive(mutex_);

            if (next_task.has_value()) {
                TickType current_tick = now_ticks();

                // Check if task is ready (handle tick overflow)
                TickType ticks_until_wake = next_task->wake_tick - current_tick;

                if (ticks_until_wake == 0 || ticks_until_wake > (TickType)(-1) / 2) {
                    // Task is ready to run immediately
                    // (ticks_until_wake > max/2 means it's in the past due to overflow)
                    if (next_task->handle && !next_task->handle.done()) {
                        next_task->handle.resume();

                        // If task completed, destroy it
                        if (next_task->handle.done()) {
                            next_task->handle.destroy();
                        }
                    }
                } else {
                    // Task is in the future, sleep until wake time or new task arrives
                    TickType wait_ticks = ticks_until_wake;

                    // Wait with timeout (returns pdTRUE if woken early by new task)
                    BaseType_t woken_early = xSemaphoreTake(wake_semaphore_, wait_ticks);

                    if (woken_early == pdTRUE) {
                        // New task was queued, put current task back and recheck queue
                        xSemaphoreTake(mutex_, portMAX_DELAY);
                        task_queue_.push(*next_task);
                        xSemaphoreGive(mutex_);
                    } else {
                        // Timeout expired, task is ready to run
                        if (next_task->handle && !next_task->handle.done()) {
                            next_task->handle.resume();

                            // If task completed, destroy it
                            if (next_task->handle.done()) {
                                next_task->handle.destroy();
                            }
                        }
                    }
                }
            } else {
                // No tasks, wait indefinitely for a new task
                xSemaphoreTake(wake_semaphore_, portMAX_DELAY);
            }
        }

        vTaskDelete(nullptr);
    }

private:
    std::priority_queue<ScheduledTask, std::vector<ScheduledTask>, std::greater<ScheduledTask>> task_queue_;
    SemaphoreHandle_t mutex_;
    SemaphoreHandle_t wake_semaphore_;
};

// Implement TaskPromise::final_suspend after MicrotaskScheduler is defined
inline auto TaskPromise::final_suspend() noexcept {
    struct FinalAwaiter {
        bool await_ready() const noexcept { return false; }

        void await_suspend(std::coroutine_handle<TaskPromise> handle) noexcept {
            auto& promise = handle.promise();
            // If there's a parent waiting for this task, resume it
            if (promise.parent_handle) {
                auto* scheduler = promise.scheduler;
                if (scheduler) {
                    scheduler->schedule_task(promise.parent_handle, now_ticks());
                }
            }
        }

        void await_resume() const noexcept {}
    };
    return FinalAwaiter{};
}

// Implement Task::operator co_await after MicrotaskScheduler is defined
inline auto Task::operator co_await() {
    struct Awaiter {
        std::coroutine_handle<TaskPromise> child_handle;

        bool await_ready() const noexcept {
            // If the child task is already done, no need to suspend
            return child_handle && child_handle.done();
        }

        void await_suspend(std::coroutine_handle<TaskPromise> parent_handle) {
            if (child_handle) {
                // Set up the parent-child relationship
                child_handle.promise().scheduler = parent_handle.promise().scheduler;
                child_handle.promise().parent_handle = parent_handle;

                // Schedule the child to run
                auto* scheduler = parent_handle.promise().scheduler;
                if (scheduler) {
                    scheduler->schedule_task(child_handle, now_ticks());
                }
            }
        }

        void await_resume() noexcept {
            // Child task completed - clean up
            if (child_handle && child_handle.done()) {
                child_handle.destroy();
            }
        }
    };

    auto h = handle_;
    handle_ = nullptr; // Transfer ownership to the awaiter
    return Awaiter{h};
}

// Implement the await_suspend for yielding
inline void TaskPromise::YieldAwaiter::await_suspend(std::coroutine_handle<TaskPromise> handle) {
    if (scheduler) {
        TickType wake_tick = now_ticks() + duration_to_ticks(delay);
        scheduler->schedule_task(handle, wake_tick);  // This requeues the task
    }
}

// Helper function to create a yield awaiter
inline auto yield_for(Duration delay) {
    struct YieldHelper {
        Duration delay;
        auto operator co_await() {
            struct Awaiter {
                Duration delay;
                MicrotaskScheduler* scheduler = nullptr;

                bool await_ready() const noexcept { return false; }

                void await_suspend(std::coroutine_handle<TaskPromise> handle) {
                    scheduler = handle.promise().scheduler;
                    if (scheduler) {
                        TickType wake_tick = now_ticks() + duration_to_ticks(delay);
                        scheduler->schedule_task(handle, wake_tick);  // Requeues task
                    }
                }

                void await_resume() const noexcept {}
            };
            return Awaiter{delay};
        }
    };
    return YieldHelper{delay};
}

// Alternative: yield for a specific number of ticks directly
inline auto yield_ticks(TickType ticks) {
    struct YieldHelper {
        TickType ticks;
        auto operator co_await() {
            struct Awaiter {
                TickType ticks;
                MicrotaskScheduler* scheduler = nullptr;

                bool await_ready() const noexcept { return false; }

                void await_suspend(std::coroutine_handle<TaskPromise> handle) {
                    scheduler = handle.promise().scheduler;
                    if (scheduler) {
                        TickType wake_tick = now_ticks() + ticks;
                        scheduler->schedule_task(handle, wake_tick);
                    }
                }

                void await_resume() const noexcept {}
            };
            return Awaiter{ticks};
        }
    };
    return YieldHelper{ticks};
}

inline auto yield_reschedule() { return yield_ticks(0); }

// Manual resume awaiter - suspends until explicitly resumed with a value
template<typename T>
class ManualResumeAwaiter {
public:
    ManualResumeAwaiter() : handle_(nullptr), value_(), resumed_(false) {}

    bool await_ready() const noexcept { return false; }

    void await_suspend(std::coroutine_handle<TaskPromise> handle) {
        handle_ = handle;
    }

    T await_resume() noexcept {
        return value_;
    }

    // Called by external code to resume the coroutine with a value
    void resume(T value) {
        if (handle_ && !resumed_) {
            value_ = value;
            resumed_ = true;
            auto* scheduler = handle_.promise().scheduler;
            if (scheduler) {
                // Schedule immediately
                scheduler->schedule_task(handle_, now_ticks());
            }
        }
    }

    bool is_suspended() const { return handle_ && !resumed_; }

private:
    std::coroutine_handle<TaskPromise> handle_;
    T value_;
    bool resumed_;
};

// Helper function to create a manual resume awaiter
template<typename T>
inline auto yield_until_resumed(ManualResumeAwaiter<T>& awaiter) {
    struct YieldHelper {
        ManualResumeAwaiter<T>& awaiter;
        auto operator co_await() {
            return awaiter;
        }
    };
    return YieldHelper{awaiter};
}

// Generic awaiter that allows setup/cleanup code and returns a value
template<typename T, typename SetupFunc, typename CleanupFunc>
class ReturnValueAwaiter {
public:
    ReturnValueAwaiter(SetupFunc&& setup, CleanupFunc&& cleanup)
        : setup_(std::move(setup)), cleanup_(std::move(cleanup)) {}

    auto operator co_await() {
        struct Awaiter {
            ReturnValueAwaiter* parent;

            bool await_ready() const noexcept { return false; }

            void await_suspend(std::coroutine_handle<TaskPromise> handle) {
                // Call the setup function, passing a pointer to the manual awaiter
                // Note: parent is the ReturnValueAwaiter which lives in the caller's stack frame
                parent->setup_(&parent->awaiter_);

                // Suspend via the manual awaiter
                parent->awaiter_.await_suspend(handle);
            }

            T await_resume() noexcept {
                T result = parent->awaiter_.await_resume();
                // Call the cleanup function
                parent->cleanup_(result);
                return result;
            }
        };
        return Awaiter{this};
    }

    // Expose the awaiter so external code can resume it
    ManualResumeAwaiter<T>& get_awaiter() { return awaiter_; }

private:
    SetupFunc setup_;
    CleanupFunc cleanup_;
    ManualResumeAwaiter<T> awaiter_;
};

// Helper function to create a return value awaiter with setup and cleanup
template<typename T, typename SetupFunc, typename CleanupFunc>
inline auto yield_with_setup_cleanup(SetupFunc&& setup, CleanupFunc&& cleanup) {
    return ReturnValueAwaiter<T, SetupFunc, CleanupFunc>(
        std::forward<SetupFunc>(setup),
        std::forward<CleanupFunc>(cleanup)
    );
}

} // namespace microtask
