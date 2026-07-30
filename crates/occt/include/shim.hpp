#pragma once

#include <cstdint>
#include <memory>

#include "rust/cxx.h"

namespace nbcad_occt {

struct FfiJob;
struct FfiMesh;

class Kernel {
 public:
  Kernel();
  ~Kernel();

  void reset();
  void apply_job(const FfiJob& job);
  rust::Vec<std::uint64_t> body_ids() const;
  FfiMesh mesh(std::uint64_t body_id) const;
  FfiMesh mesh_with_deflection(
      std::uint64_t body_id,
      double linear_deflection,
      double angular_deflection) const;
  rust::Vec<std::uint8_t> export_step(
      const rust::Vec<std::uint64_t>& body_ids,
      rust::Str thread_metadata_hex) const;

 private:
  class Impl;
  std::unique_ptr<Impl> impl_;
};

std::unique_ptr<Kernel> new_kernel();

}  // namespace nbcad_occt
