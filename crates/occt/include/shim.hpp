#pragma once

#include <cstdint>
#include <memory>

#include "rust/cxx.h"

namespace nbcad_occt {

struct FfiJob;
struct FfiMesh;
struct FfiDrawingProjection;

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
  FfiDrawingProjection drawing_projection(
      const rust::Vec<std::uint64_t>& body_ids,
      double direction_x,
      double direction_y,
      double direction_z,
      double up_x,
      double up_y,
      double up_z,
      bool include_hidden,
      bool include_tangent_edges,
      double deflection,
      bool has_section_plane,
      double section_point_x,
      double section_point_y,
      double section_point_z,
      double section_normal_x,
      double section_normal_y,
      double section_normal_z,
      bool has_section_depth,
      double section_depth) const;

 private:
  class Impl;
  std::unique_ptr<Impl> impl_;
};

std::unique_ptr<Kernel> new_kernel();

}  // namespace nbcad_occt
