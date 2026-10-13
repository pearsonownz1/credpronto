-- Customer files upload directly into the private originals bucket.
-- The project global cap is 50MB. A null bucket limit uses that cap; a lower
-- bucket limit would reject a 50MB signed upload, so pin the bucket at 50MB.
update storage.buckets
set file_size_limit = 52428800
where id = 'originals'
  and (file_size_limit is null or file_size_limit < 52428800);
