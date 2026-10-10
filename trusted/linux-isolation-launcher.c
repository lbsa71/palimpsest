/* Trusted Linux x86-64 launcher, run only inside the host-built Bubblewrap
 * namespace. No candidate input selects its executable policy or child mode.
 * Build externally; see docs/work-items/linux-candidate-isolation.md. */
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <linux/audit.h>
#include <linux/capability.h>
#include <linux/filter.h>
#include <linux/landlock.h>
#include <linux/mount.h>
#include <linux/sched.h>
#include <linux/seccomp.h>
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/prctl.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <unistd.h>

#if !defined(__x86_64__) || defined(__ILP32__)
#error Only the Linux x86-64 syscall ABI is supported
#endif

static void unavailable(const char *operation) {
  fprintf(stderr, "Linux isolation unavailable: %s: %s\n", operation, strerror(errno));
  _exit(125);
}

/* The only setup capability exists in Bubblewrap's new user/mount namespace.
 * noexec closes direct dynamic-loader execution of an unapproved readable ELF.
 * Exact approved binaries have their own final bind mounts, so clearing noexec
 * on them cannot clear it on their source/scratch parent mounts. */
static void restrict_mount_execution(int roots, char **paths, int executables, char **allowed) {
  struct mount_attr noexec = { .attr_set = MOUNT_ATTR_NOEXEC };
  for (int i = 0; i < roots; i++)
    if (syscall(SYS_mount_setattr, AT_FDCWD, paths[i], AT_RECURSIVE, &noexec, sizeof(noexec))) unavailable("recursive noexec mount");
  struct mount_attr exec = { .attr_clr = MOUNT_ATTR_NOEXEC };
  for (int i = 0; i < executables; i++)
    if (syscall(SYS_mount_setattr, AT_FDCWD, allowed[i], 0, &exec, sizeof(exec))) unavailable("exact executable mount");
  for (int capability = 0; capability < 64; capability++) {
    int present = prctl(PR_CAPBSET_READ, capability, 0, 0, 0);
    if (present < 0) { if (errno == EINVAL) break; unavailable("bounding capability observation"); }
    if (present && prctl(PR_CAPBSET_DROP, capability, 0, 0, 0)) unavailable("bounding capability removal");
  }
  if (prctl(PR_CAP_AMBIENT, PR_CAP_AMBIENT_CLEAR_ALL, 0, 0, 0)) unavailable("ambient capability removal");
  struct __user_cap_header_struct header = { .version = _LINUX_CAPABILITY_VERSION_3, .pid = 0 };
  struct __user_cap_data_struct empty[2] = {{0}, {0}};
  if (syscall(SYS_capset, &header, empty)) unavailable("capability removal");
}

/* Landlock is inode-bound and inherited across exec/fork. No directory EXECUTE
 * rule is granted: candidate-created ELF, scripts, memfds and aliases to other
 * files cannot become installed executables merely by being readable. */
static void restrict_executables(int count, char **paths, int writable_count, char **writable) {
  if (syscall(SYS_landlock_create_ruleset, NULL, 0, LANDLOCK_CREATE_RULESET_VERSION) < 3)
    unavailable("Landlock ABI");
  const __u64 write_rights = LANDLOCK_ACCESS_FS_WRITE_FILE | LANDLOCK_ACCESS_FS_TRUNCATE;
  struct landlock_ruleset_attr rules = { .handled_access_fs = LANDLOCK_ACCESS_FS_EXECUTE | write_rights | LANDLOCK_ACCESS_FS_REFER };
  int rules_fd = syscall(SYS_landlock_create_ruleset, &rules, sizeof(rules), 0);
  if (rules_fd < 0) unavailable("Landlock ruleset");
  for (int i = 0; i < count; i++) {
    int fd = open(paths[i], O_PATH | O_CLOEXEC | O_NOFOLLOW);
    struct stat metadata;
    if (fd < 0 || fstat(fd, &metadata) || !S_ISREG(metadata.st_mode)) unavailable("executable identity");
    struct landlock_path_beneath_attr rule = { .allowed_access = LANDLOCK_ACCESS_FS_EXECUTE, .parent_fd = fd };
    if (syscall(SYS_landlock_add_rule, rules_fd, LANDLOCK_RULE_PATH_BENEATH, &rule, 0)) unavailable("Landlock executable rule");
    close(fd);
  }
  /* Regular mounts are read-only except explicit scratch. Also deny writes to
   * runtime devices and proc files: a read-only descriptor cannot modify them.
   * REFER is explicit so ordinary moves within writable scratch still work. */
  for (int i = 0; i <= writable_count; i++) {
    int fd = open(i < writable_count ? writable[i] : "/dev/null", O_PATH | O_CLOEXEC | O_NOFOLLOW);
    if (fd < 0) unavailable("writable identity");
    struct landlock_path_beneath_attr rule = { .allowed_access = write_rights | (i < writable_count ? LANDLOCK_ACCESS_FS_REFER : 0), .parent_fd = fd };
    if (syscall(SYS_landlock_add_rule, rules_fd, LANDLOCK_RULE_PATH_BENEATH, &rule, 0)) unavailable("Landlock writable rule");
    close(fd);
  }
  if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0)) unavailable("no_new_privs");
  if (syscall(SYS_landlock_restrict_self, rules_fd, 0)) unavailable("Landlock enforcement");
  close(rules_fd);
}

#define DENY(number) BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, (number), 0, 1), BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | EPERM)
static void restrict_syscalls(int children) {
  /* Reject alternate architectures and x32 before testing syscall numbers.
   * clone3 has a pointer argument; ENOSYS makes libc use inspectable clone.
   * The default clone policy admits threads only. */
  struct sock_filter policy[] = {
    BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, arch)),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, AUDIT_ARCH_X86_64, 1, 0),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_KILL_PROCESS),
    BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, nr)),
    BPF_JUMP(BPF_JMP | BPF_JGE | BPF_K, 0x40000000, 0, 1),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_KILL_PROCESS),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, SYS_clone3, 0, 1),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | ENOSYS),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, SYS_clone, 0, 6),
    BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[0])),
    BPF_JUMP(BPF_JMP | BPF_JSET | BPF_K, CLONE_NEWCGROUP | CLONE_NEWIPC | CLONE_NEWNET | CLONE_NEWNS | CLONE_NEWPID | CLONE_NEWTIME | CLONE_NEWUSER | CLONE_NEWUTS, 0, 1),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | EPERM),
    BPF_JUMP(BPF_JMP | BPF_JSET | BPF_K, children ? 0xffffffff : CLONE_THREAD, 1, 0),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | EPERM),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW),
    /* Preserve Bubblewrap's parent-death watchdog; thread naming still works. */
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, SYS_prctl, 0, 3),
    BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[0])),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, PR_SET_PDEATHSIG, 0, 1),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | EPERM),
    BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, nr)),
    DENY(SYS_socket), DENY(SYS_connect), DENY(SYS_bind), DENY(SYS_listen),
    DENY(SYS_accept), DENY(SYS_accept4), DENY(SYS_sendto),
    DENY(SYS_ptrace), DENY(SYS_process_vm_readv), DENY(SYS_process_vm_writev),
    DENY(SYS_pidfd_getfd), DENY(SYS_pidfd_open), DENY(SYS_memfd_create),
    DENY(SYS_io_uring_setup), DENY(SYS_bpf), DENY(SYS_userfaultfd),
    DENY(SYS_perf_event_open), DENY(SYS_mount), DENY(SYS_mount_setattr), DENY(SYS_umount2),
    DENY(SYS_fsopen), DENY(SYS_fsconfig), DENY(SYS_fsmount), DENY(SYS_open_tree), DENY(SYS_move_mount),
    DENY(SYS_pivot_root), DENY(SYS_chroot), DENY(SYS_unshare), DENY(SYS_setns),
    DENY(SYS_setsid), DENY(SYS_setpgid), DENY(SYS_open_by_handle_at),
    DENY(SYS_execveat), DENY(SYS_mknod), DENY(SYS_mknodat),
    DENY(SYS_keyctl), DENY(SYS_add_key), DENY(SYS_request_key),
    DENY(SYS_reboot), DENY(SYS_kexec_load), DENY(SYS_kexec_file_load),
    DENY(SYS_init_module), DENY(SYS_finit_module), DENY(SYS_delete_module),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, SYS_fork, 0, 1),
    BPF_STMT(BPF_RET | BPF_K, children ? SECCOMP_RET_ALLOW : SECCOMP_RET_ERRNO | EPERM),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, SYS_vfork, 0, 1),
    BPF_STMT(BPF_RET | BPF_K, children ? SECCOMP_RET_ALLOW : SECCOMP_RET_ERRNO | EPERM),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW),
  };
  struct sock_fprog filter = { .len = sizeof(policy) / sizeof(policy[0]), .filter = policy };
  if (prctl(PR_SET_SECCOMP, SECCOMP_MODE_FILTER, &filter)) unavailable("seccomp enforcement");
}

int main(int argc, char **argv) {
  /* Fixed framing: launcher 0|1 N executable... M noexec-root... W writable... -- program args.
   * The interpreter is an allowed runtime file, never a selected entrypoint. */
  if (argc < 6 || (strcmp(argv[1], "0") && strcmp(argv[1], "1"))) { errno = EINVAL; unavailable("launcher arguments"); }
  char *end = NULL; long count = strtol(argv[2], &end, 10);
  if (!end || *end || count < 2 || count > 129 || argc < count + 6) { errno = EINVAL; unavailable("launcher executable count"); }
  long roots = strtol(argv[count + 3], &end, 10);
  if (!end || *end || roots < 1 || roots > 1024 || argc < count + roots + 7) { errno = EINVAL; unavailable("launcher root count"); }
  long writes = strtol(argv[count + roots + 4], &end, 10);
  if (!end || *end || writes < 0 || writes > 1024 || argc < count + roots + writes + 7 || strcmp(argv[count + roots + writes + 5], "--")) { errno = EINVAL; unavailable("launcher writable count"); }
  int program = count + roots + writes + 6, selected = 0;
  for (int i = 3; i < count + 2; i++) if (!strcmp(argv[i], argv[program])) selected = 1;
  if (!selected) { errno = EACCES; unavailable("unselected program"); }
  restrict_mount_execution(roots, &argv[count + 4], count, &argv[3]);
  restrict_executables(count, &argv[3], writes, &argv[count + roots + 5]);
  restrict_syscalls(!strcmp(argv[1], "1"));
  execv(argv[program], &argv[program]);
  unavailable("selected exec");
}
