pub(crate) fn transform_dynamic_image(
    mut img: image::DynamicImage,
    flip_x: bool,
    flip_y: bool,
    rotation: u32,
) -> image::DynamicImage {
    img = match rotation % 360 {
        90 => img.rotate90(),
        180 => img.rotate180(),
        270 => img.rotate270(),
        _ => img,
    };
    if flip_x {
        img = img.fliph();
    }
    if flip_y {
        img = img.flipv();
    }
    img
}
